"use client";

import { useEffect, useRef, useState } from "react";
import {
  ALLOW_HEADING, APPLE_ON_WEB, appleSignInURL, destination, functionURL, pkcePair, returnURL, signInError, startsWithWrite, universalLink,
  type ConnectLabel, type ConnectRequest,
} from "@/lib/connect";
import {
  browserOn, leadFor, parseDevices, type Devices, type Lead,
  browserFrom, newPageNonce, newPickup, pageCommit, pageNumber, parseKeyRow, recoveryApproval, RecoveryError, revealRequest, sealedDestination,
  statusRequest, statusStep, withCode,
  type AccountKey,
} from "@/lib/connect-flow";
import { newHandoffKeys, openHandoff, parseRecoveryKey, toBase64 } from "@/lib/e2ee";
import { EmailFields, EndedScreen, ErrorLine, LeavingScreen, RequestLine, SignInButtons, Spinner, Steps } from "./ConnectScreens";
import { DeviceScreen } from "./DeviceLead";
import styles from "./connect.module.css";

// The connect page as it was before the QR code (ConnectFlow.tsx): sign in, a notification on your
// devices, a number to type there, "Open Amber Notes" for the app on this computer, or the
// recovery key. Apps before 1.2 can't scan the code, so /connect shows this until 1.2 is public
// (lib/connect.ts, qrConnectLive). Delete it, its test and that switch once 1.2 is the oldest app
// in use. The server keeps this flow either way: it is also the QR page's "Get a notification instead".

type Session = { token: string; userId: string; email: string };
type Mode = "devices" | "recover";
type View =
  | { kind: "signIn" }
  | { kind: "working"; text: string }
  | { kind: "waiting" }
  | { kind: "recover" }
  | { kind: "leaving"; to: string; allowed: boolean }
  | { kind: "ended"; title: string; text: string; retry?: boolean };

/// The PKCE verifier for one Sign in with Apple round trip: the only thing the page ever stores.
const APPLE_PKCE = "amber.connect.pkce";
const POLL_MS = 2000;
/// After this long without an answer the page says where the request shows, and points to the recovery key.
export const NUDGE_MS = 20_000;
const OFFLINE = "Couldn't reach Amber Notes. Check your connection and try again.";
/// While Sign in with Apple is off on the web: an account made with it has no password, so it allows in the app.
export const APPLE_INSTEAD = "Signed up with Apple? Allow it in Amber Notes instead: open the app on this computer, or connect from your iPhone.";
const EXPIRED: View = { kind: "ended", title: "This request has expired", text: "Start connecting again from ChatGPT, Claude or the other app you were using." };

export default function ConnectFlowV1({ requestId, supabaseURL, anonKey, label, recover, authCode, authError }: {
  requestId: string;
  supabaseURL: string;
  anonKey: string;
  label: ConnectLabel | null;
  /// Back from Sign in with Apple started on the recovery key view.
  recover: boolean;
  /// Back from Sign in with Apple: Supabase's one-time code, or why it failed.
  authCode?: string;
  authError?: string;
}) {
  const [mode, setMode] = useState<Mode>(recover ? "recover" : "devices");
  const [view, setView] = useState<View>(authCode ? { kind: "working", text: "Signing in…" } : { kind: "signIn" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [write, setWrite] = useState(true);
  const [request, setRequest] = useState<ConnectRequest | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [polling, setPolling] = useState(false);
  // Kept out of React state: the session and the key pair live in this page's memory only.
  const session = useRef<Session | null>(null);
  const [signedIn, setSignedIn] = useState<string | null>(null);
  const handoffKey = useRef<CryptoKey | null>(null);
  /// The pickup secret: /connect/status hands the answer only to it.
  const pickup = useRef<string | null>(null);
  /// The page's nonce Np, public key and whether Np has gone to /connect/reveal (only once).
  const pageNonce = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const publicRaw = useRef<Uint8Array | null>(null);
  const revealed = useRef(false);
  /// The two digits to type on the device, once the device's nonce is in and Np is revealed.
  const [number, setNumber] = useState<string | null>(null);
  // Where the account has Amber Notes (from /connect/ask), and so the one device the page names.
  const [devices, setDevices] = useState<Devices | null>(null);
  const [lead, setLead] = useState<Lead>("any");
  const expiresAt = useRef<number | null>(null);
  const finished = useRef(false);
  const mcp = functionURL(supabaseURL);
  const base = supabaseURL.replace(/\/+$/, "");

  useEffect(() => {
    setReady(true);
    if (authCode) void finishAppleSignIn(authCode);
    else if (authError) {
      setFailure("Sign in with Apple didn't finish. Try again.");
      window.history.replaceState(null, "", returnURL(window.location.origin, requestId, recover));
    }
    // A closed or reloaded page ends a session it still holds.
    const closing = () => { if (session.current) void signOut(session.current.token, true); };
    window.addEventListener("pagehide", closing);
    return () => window.removeEventListener("pagehide", closing);
    // Runs once, for the address the page was opened with.
  }, []);

  // No answer for a while: say where the request shows up (a closed iPhone app doesn't get it).
  const [nudge, setNudge] = useState(false);
  useEffect(() => {
    if (!polling) { setNudge(false); return; }
    const t = setTimeout(() => setNudge(true), NUDGE_MS);
    return () => clearTimeout(t);
  }, [polling]);

  // Waiting for a device: /connect/status every two seconds until there's an answer or it expires.
  useEffect(() => {
    if (!polling) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stopped || finished.current) return;
      let body: unknown = null;
      try {
        const secret = pickup.current;
        if (secret) {
          const res = await fetch(...statusRequest(mcp, requestId, secret));
          if (res.ok) body = await res.json();
        }
      } catch {}
      if (stopped || finished.current) return;
      const step = statusStep(body, Date.now(), expiresAt.current);
      switch (step.kind) {
        case "wait":
          timer = setTimeout(tick, POLL_MS);
          return;
        case "deviceReady": {
          // The device opened the request and committed to its nonce: reveal ours, once, then show the number.
          if (!revealed.current) {
            const np = pageNonce.current, pub = publicRaw.current, secret = pickup.current;
            if (!np || !pub || !secret) return end({ kind: "ended", title: "Couldn't finish here", text: "Start connecting again from the other app." });
            let res: Response | null = null;
            try { res = await fetch(...revealRequest(mcp, requestId, secret, np)); } catch {}
            if (stopped || finished.current) return;
            if (res && !res.ok) {
              const b = await res.json().catch(() => null) as { error?: string } | null;
              if (res.status === 404) return end(EXPIRED);
              return end({ kind: "ended", title: "Couldn't connect", text: b?.error ?? OFFLINE, retry: true });
            }
            if (res) {
              revealed.current = true;
              setNumber(await pageNumber(pub, np, step.deviceNonce, requestId));
            }
          }
          timer = setTimeout(tick, POLL_MS);
          return;
        }
        case "approved": {
          const key = handoffKey.current;
          if (!key) return end({ kind: "ended", title: "Couldn't finish here", text: "Start connecting again from the other app." });
          try {
            // Only where the approving device sealed it, never the answer's unsealed redirect.
            return leave(sealedDestination(await openHandoff(step.handoff, key, requestId)), true);
          } catch {
            return end({ kind: "ended", title: "Couldn't finish here", text: "Start connecting again from the other app." });
          }
        }
        case "denied":
          if (step.redirect) return leave(step.redirect, false);
          return end({ kind: "ended", title: "Not connected", text: "The request was declined. You can close this page." });
        case "answeredInApp": return end({ kind: "ended", title: "Finished in Amber Notes", text: "You can close this page." });
        case "delivered": return end({ kind: "ended", title: "Answered in another window", text: "If connecting didn't finish, start again from the other app." });
        case "expired": return end(EXPIRED);
      }
    };
    timer = setTimeout(tick, POLL_MS);
    return () => { stopped = true; clearTimeout(timer); };
  }, [polling]);

  function end(v: View) {
    finished.current = true;
    handoffKey.current = null;
    pickup.current = null;
    pageNonce.current?.fill(0);
    pageNonce.current = null;
    publicRaw.current = null;
    revealed.current = false;
    setNumber(null);
    setPolling(false);
    setView(v);
  }

  function leave(to: string, allowed: boolean) {
    end({ kind: "leaving", to, allowed });
    window.location.assign(to);
  }

  // MARK: Signing in

  async function signInWithApple() {
    setBusy(true);
    const { verifier, challenge } = await pkcePair();
    const recovering = mode === "recover";
    try { sessionStorage.setItem(APPLE_PKCE, JSON.stringify({ verifier, request: requestId })); } catch {}
    window.location.assign(appleSignInURL(supabaseURL, returnURL(window.location.origin, requestId, recovering), challenge));
  }

  async function finishAppleSignIn(code: string) {
    // The code leaves the address bar (and the history) before anything else happens.
    window.history.replaceState(null, "", returnURL(window.location.origin, requestId, recover));
    let saved: { verifier?: string; request?: string } = {};
    try {
      saved = JSON.parse(sessionStorage.getItem(APPLE_PKCE) ?? "{}");
    } catch {}
    try { sessionStorage.removeItem(APPLE_PKCE); } catch {}
    if (!saved.verifier || saved.request !== requestId) {
      setView({ kind: "signIn" });
      setFailure("Sign in with Apple didn't finish. Try again.");
      return;
    }
    try {
      const res = await fetch(`${base}/auth/v1/token?grant_type=pkce`, {
        method: "POST",
        headers: { apikey: anonKey, "content-type": "application/json" },
        body: JSON.stringify({ auth_code: code, code_verifier: saved.verifier }),
      });
      const s = sessionFrom(await res.json().catch(() => null), "your Apple ID");
      if (!res.ok || !s) {
        setView({ kind: "signIn" });
        setFailure("Sign in with Apple didn't finish. Try again.");
        return;
      }
      await signedInAs(s, recover ? "recover" : "devices");
    } catch {
      setView({ kind: "signIn" });
      setFailure(OFFLINE);
    }
  }

  async function passwordSignIn(): Promise<Session | null> {
    const res = await fetch(`${base}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anonKey, "content-type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
    });
    const body = await res.json().catch(() => null);
    const s = res.ok ? sessionFrom(body, email.trim()) : null;
    if (!s) setFailure(signInError(res.status, body));
    else setPassword("");
    return s;
  }

  async function submitSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const s = await passwordSignIn();
      if (s) await signedInAs(s, "devices");
    } catch {
      setFailure(OFFLINE);
    } finally {
      setBusy(false);
    }
  }

  async function signedInAs(s: Session, m: Mode) {
    session.current = s;
    setSignedIn(s.email);
    if (m === "devices") await ask(s);
    else await loadRecover(s);
  }

  /// Ends the web session. It was only for this one step.
  async function signOut(token: string, closing = false) {
    if (session.current?.token === token) {
      session.current = null;
      setSignedIn(null);
    }
    const ended = fetch(`${base}/auth/v1/logout?scope=local`, {
      method: "POST", keepalive: closing,
      headers: { apikey: anonKey, authorization: `Bearer ${token}` },
    }).catch(() => undefined);
    if (!closing) await Promise.race([ended, new Promise((r) => setTimeout(r, 1500))]);
  }

  // MARK: Asking your devices

  async function ask(s: Session) {
    setView({ kind: "working", text: "Asking your iPhone or Mac…" });
    try {
      const keys = await newHandoffKeys();
      const secret = await newPickup();
      const np = newPageNonce();
      const res = await fetch(`${mcp}/connect/ask`, {
        method: "POST",
        headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
        body: JSON.stringify({
          id: requestId, browser_key: toBase64(keys.publicRaw), pickup_hash: secret.pickup_hash, from: browserFrom(navigator.userAgent),
          match_commit: await pageCommit(keys.publicRaw, np),
        }),
      });
      const body = await res.json().catch(() => null) as { expires_at?: string; error?: string } | null;
      const has = res.ok ? parseDevices(body) : null;
      const next = leadFor(has, browserOn(navigator.platform, navigator.userAgent, navigator.maxTouchPoints));
      // No app seen lately: the recovery key leads, and it needs this session.
      if (!res.ok || next !== "recover") await signOut(s.token);
      if (!res.ok) {
        np.fill(0);
        if (res.status === 404) return end(EXPIRED);
        // A 429 can mean the account's connecting is paused for a while: the server's message says how long.
        return end({ kind: "ended", title: "Couldn't connect", text: body?.error ?? OFFLINE, retry: res.status !== 429 });
      }
      handoffKey.current = keys.privateKey;
      pickup.current = secret.pickup;
      pageNonce.current = np;
      publicRaw.current = keys.publicRaw;
      revealed.current = false;
      setNumber(null);
      const t = Date.parse(body?.expires_at ?? "");
      expiresAt.current = Number.isNaN(t) ? null : t;
      finished.current = false;
      setDevices(has);
      setLead(next);
      setPolling(true);
      if (next === "recover") return await loadRecover(s);
      setMode("devices");
      setView({ kind: "waiting" });
    } catch {
      await signOut(s.token);
      end({ kind: "ended", title: "Couldn't connect", text: OFFLINE, retry: true });
    }
  }

  // MARK: The recovery key

  function forget() {
    setRecoveryKey("");
  }

  /// What the recovery key needs from the server: the request (its exact return address) and the
  /// account's key row. Neither is a key.
  async function fetchRecoverInfo(s: Session): Promise<{ request: ConnectRequest; row: AccountKey | null } | { error: string; expired?: boolean }> {
    const [r, k] = await Promise.all([
      fetch(`${mcp}/connect/request?id=${requestId}`, { headers: { authorization: `Bearer ${s.token}` }, cache: "no-store" }),
      fetch(`${base}/rest/v1/account_keys?select=key_id,verifier,recovery_wrap`, {
        headers: { apikey: anonKey, authorization: `Bearer ${s.token}`, accept: "application/json" }, cache: "no-store",
      }),
    ]);
    const request = await r.json().catch(() => null);
    if (!r.ok || typeof request?.redirect_uri !== "string") return { error: request?.error ?? OFFLINE, expired: r.status === 404 };
    if (!k.ok) return { error: OFFLINE };
    return { request: request as ConnectRequest, row: parseKeyRow(await k.json().catch(() => null)) };
  }

  async function loadRecover(s: Session) {
    setView({ kind: "working", text: "Loading…" });
    try {
      const info = await fetchRecoverInfo(s);
      if ("error" in info) {
        await signOut(s.token);
        return end(info.expired ? EXPIRED : { kind: "ended", title: "Couldn't connect", text: info.error, retry: true });
      }
      setRequest(info.request);
      setWrite(startsWithWrite(info.request));
      setMode("recover");
      setView({ kind: "recover" });
    } catch {
      setView({ kind: "recover" });
      setFailure(OFFLINE);
    }
  }

  async function submitRecovery(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const typed = recoveryKey;
    forget();
    try {
      // A typo shows before anything is sent anywhere.
      const check = await parseRecoveryKey(typed);
      if (!check) throw new RecoveryError("typo");
      check.fill(0);
      let s = session.current;
      if (!s) {
        s = await passwordSignIn();
        if (!s) return;
        session.current = s;
        setSignedIn(s.email);
      }
      const info = await fetchRecoverInfo(s);
      if ("error" in info) {
        if (info.expired) { await signOut(s.token); return end(EXPIRED); }
        setFailure(info.error);
        return;
      }
      setRequest(info.request);
      if (!info.row) {
        setFailure("Set up Amber Notes on your iPhone or Mac first.");
        return;
      }
      setView({ kind: "working", text: "Checking your recovery key…" });
      // Nothing from a device should race this answer.
      finished.current = true;
      setPolling(false);
      const approval = await recoveryApproval(typed, s.userId, info.row);
      const res = await fetch(`${mcp}/connect/decide`, {
        method: "POST",
        headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
        body: JSON.stringify({
          id: requestId, allow: true, write: write && info.request.wants_write, redirect_uri: info.request.redirect_uri,
          code_hash: approval.code_hash, code_wrap: approval.code_wrap,
        }),
      });
      const body = await res.json().catch(() => null) as { redirect?: string; error?: string } | null;
      if (!res.ok || typeof body?.redirect !== "string") {
        await signOut(s.token);
        if (res.status === 404) return end(EXPIRED);
        return end({ kind: "ended", title: "Couldn't connect", text: body?.error ?? OFFLINE, retry: true });
      }
      await signOut(s.token);
      leave(withCode(body.redirect, approval.code), true);
    } catch (err) {
      resumeWaiting();
      setView({ kind: "recover" });
      setFailure(err instanceof RecoveryError ? err.message : OFFLINE);
    } finally {
      setBusy(false);
    }
  }

  /// Back to waiting on the devices if this page asked them.
  function resumeWaiting() {
    if (handoffKey.current) {
      finished.current = false;
      setPolling(true);
    }
  }

  function showRecovery() {
    forget();
    setFailure(null);
    setMode("recover");
    setView({ kind: "recover" });
  }

  async function backToDevices() {
    forget();
    setFailure(null);
    setMode("devices");
    if (handoffKey.current) {
      if (session.current) await signOut(session.current.token);
      setView({ kind: "waiting" });
      return;
    }
    if (session.current) return ask(session.current);
    setView({ kind: "signIn" });
  }

  function startOver() {
    forget();
    setFailure(null);
    finished.current = false;
    setView(mode === "recover" && session.current ? { kind: "recover" } : { kind: "signIn" });
  }

  // MARK: The page

  const heading = ALLOW_HEADING;
  const to = label?.redirect_host ? destination(label.redirect_host, label.loopback) : null;
  const recovering = mode === "recover" && (view.kind === "signIn" || view.kind === "recover");
  const canWrite = request ? request.wants_write : true;

  return (
    <>
      {view.kind === "signIn" && !recovering && (
        <>
          <Steps at={1} to={to} />
          <h1 className={styles.title}>{heading}</h1>
          <RequestLine to={to} claimed={label?.claimed_name} />
          <p className={styles.lede}>Sign in, and Amber Notes asks you on your iPhone or Mac.</p>
          {APPLE_ON_WEB && <SignInButtons onApple={signInWithApple} busy={busy} />}
          <form className={styles.form} method="post" onSubmit={submitSignIn}>
            <EmailFields email={email} password={password} onEmail={setEmail} onPassword={setPassword} />
            <ErrorLine text={failure} />
            <button type="submit" className={styles.secondary} disabled={!ready || busy} aria-busy={busy}>
              {busy ? <><Spinner /> Signing in…</> : "Sign in with email"}
            </button>
          </form>
          <div className={styles.quiet}>
            <p>Amber Notes on this computer? <a href={universalLink(requestId)}>Open Amber Notes</a></p>
            {!APPLE_ON_WEB && <p>{APPLE_INSTEAD}</p>}
            <p>No account yet? <a href="/download">Get Amber Notes</a></p>
          </div>
        </>
      )}

      {view.kind === "working" && (
        <p className={styles.status} role="status"><Spinner /> {view.text}</p>
      )}

      {view.kind === "waiting" && devices && lead !== "recover" && lead !== "any" && (
        <DeviceScreen
          lead={lead} devices={devices} number={number} action="type" openLink={universalLink(requestId)} onRecover={showRecovery}
          steps={<Steps at={2} to={to} />}
        />
      )}

      {view.kind === "waiting" && !(devices && lead !== "recover" && lead !== "any") && (
        <>
          <Steps at={2} to={to} />
          {number ? (
            <>
              <h1 className={styles.title}>Approve on your iPhone or Mac</h1>
              <MatchNumber number={number} />
              <p className={styles.lede}>Type this number in Amber Notes there, then Allow, and this page takes you back to finish connecting. If Amber Notes doesn't ask for it, choose Don't allow.</p>
              <p className={styles.status} role="status"><Spinner /> Waiting for you to allow it on your iPhone or Mac…</p>
            </>
          ) : (
            <>
              <h1 className={styles.title}>Open Amber Notes on your iPhone or Mac</h1>
              <p className={styles.lede}>Amber Notes there asks you about this request. When it opens it, a number shows here for you to type there.</p>
              <p className={styles.status} role="status"><Spinner /> Waiting for your iPhone or Mac…</p>
            </>
          )}
          {nudge && (
            <p className={styles.small} role="status">
              Open Amber Notes on your iPhone or Mac to see the request. No device nearby? Use your recovery key below.
            </p>
          )}
          <a className={styles.secondary} href={universalLink(requestId)}>Open Amber Notes</a>
          <p className={styles.small}>Answer in the app if it's on this computer.</p>
          <button type="button" className={styles.link} onClick={showRecovery}>No device nearby? Use your recovery key</button>
        </>
      )}

      {recovering && (
        <>
          <Steps at={2} to={to} />
          <h1 className={styles.title}>{heading}</h1>
          {request
            ? <RequestLine to={destination(request.redirect_host, request.loopback)} claimed={request.claimed_name} />
            : <RequestLine to={to} claimed={label?.claimed_name} />}
          {lead === "recover" && <p className={styles.lede}>No iPhone or Mac has opened Amber Notes on this account in the last 30 days, so allow it here with your recovery key.</p>}
          <p className={styles.note}>
            This runs our code in your browser. Your recovery key and your notes' key are used on this page only, and are never stored or sent to us.
            If this page were changed, it could read them. When you can, approve from your iPhone or Mac instead.
          </p>
          {!signedIn && APPLE_ON_WEB && <SignInButtons onApple={signInWithApple} busy={busy} />}
          {!signedIn && !APPLE_ON_WEB && <p className={styles.small}>{APPLE_INSTEAD}</p>}
          <form className={styles.form} method="post" onSubmit={submitRecovery}>
            {signedIn ? null : <EmailFields email={email} password={password} onEmail={setEmail} onPassword={setPassword} />}
            <label className={styles.field}>
              <span>Recovery key</span>
              <input
                type="text" id="connect-recovery" required autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false}
                placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" className={styles.code}
                value={recoveryKey} onChange={(e) => setRecoveryKey(e.target.value)}
              />
            </label>
            <div className={styles.segmented} role="radiogroup" aria-label="Access">
              <button type="button" role="radio" aria-checked={write && canWrite} disabled={!canWrite} onClick={() => setWrite(true)}>Read and edit</button>
              <button type="button" role="radio" aria-checked={!(write && canWrite)} onClick={() => setWrite(false)}>Read only</button>
            </div>
            <p className={styles.explain}>{write && canWrite
              ? "It can search, read, create and change notes. Every change keeps the previous version."
              : "It can search and read notes, but not change them."}</p>
            <p className={styles.warn}>Only allow it if you just started connecting it yourself.</p>
            <ErrorLine text={failure} />
            <button type="submit" className={styles.primary} disabled={!ready || busy} aria-busy={busy}>
              {busy ? <><Spinner /> Allowing…</> : "Allow"}
            </button>
          </form>
          {signedIn && <p className={styles.small}>Signed in as {signedIn}.</p>}
          <button type="button" className={styles.link} onClick={backToDevices}>Approve on your iPhone or Mac instead</button>
        </>
      )}

      {view.kind === "leaving" && <LeavingScreen allowed={view.allowed} host={hostOf(view.to)} />}

      {view.kind === "ended" && <EndedScreen title={view.title} text={view.text} onRetry={view.retry ? startOver : undefined} />}
    </>
  );
}

/// The signed-in account, from a Supabase Auth token response.
function sessionFrom(body: { access_token?: unknown; user?: { id?: unknown; email?: unknown } } | null, fallbackEmail: string): Session | null {
  if (typeof body?.access_token !== "string" || typeof body.user?.id !== "string") return null;
  return { token: body.access_token, userId: body.user.id, email: typeof body.user.email === "string" ? body.user.email : fallbackEmail };
}

/// The two digits you type on the device (matchNumber of this page's key, both nonces and the request).
export function MatchNumber({ number }: { number: string }) {
  return (
    <div className={styles.match}>
      <span className={styles.matchNumber} aria-hidden="true">{number}</span>
      <p className={styles.matchText}>Type {number} on your iPhone or Mac</p>
    </div>
  );
}

function hostOf(url: string): string {
  try { return new URL(url).hostname || "the app"; } catch { return "the app"; }
}

