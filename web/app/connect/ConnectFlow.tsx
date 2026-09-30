"use client";

import { useEffect, useRef, useState } from "react";
import {
  ALLOW_HEADING, appleSignInURL, destination, functionURL, pkcePair, returnURL, signInError, universalLink,
  type ConnectLabel, type ConnectRequest,
} from "@/lib/connect";
import {
  browserFrom, newPickup, pageNumber, parseKeyRow, recoveryApproval, RecoveryError, sealedDestination, statusRequest, statusStep, withCode,
  type AccountKey,
} from "@/lib/connect-flow";
import { newHandoffKeys, openHandoff, parseRecoveryKey, toBase64 } from "@/lib/e2ee";
import styles from "./connect.module.css";

// The connect page in the browser. See lib/connect.ts for the whole flow.

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
const EXPIRED: View = { kind: "ended", title: "This request has expired", text: "Start connecting again from ChatGPT, Claude or the other app you were using." };

export default function ConnectFlow({ requestId, supabaseURL, anonKey, label, recover, authCode, authError }: {
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
  const [write, setWrite] = useState(false);
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
  /// The two digits to tap on the device, once the ask is in.
  const [number, setNumber] = useState<string | null>(null);
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
        case "denied": return leave(step.redirect, false);
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
      const res = await fetch(`${mcp}/connect/ask`, {
        method: "POST",
        headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
        body: JSON.stringify({
          id: requestId, browser_key: toBase64(keys.publicRaw), pickup_hash: secret.pickup_hash, from: browserFrom(navigator.userAgent),
        }),
      });
      const body = await res.json().catch(() => null) as { expires_at?: string; error?: string } | null;
      await signOut(s.token);
      if (!res.ok) {
        if (res.status === 404) return end(EXPIRED);
        return end({ kind: "ended", title: "Couldn't connect", text: body?.error ?? OFFLINE, retry: true });
      }
      handoffKey.current = keys.privateKey;
      pickup.current = secret.pickup;
      setNumber(await pageNumber(keys.publicRaw, requestId));
      const t = Date.parse(body?.expires_at ?? "");
      expiresAt.current = Number.isNaN(t) ? null : t;
      finished.current = false;
      setMode("devices");
      setView({ kind: "waiting" });
      setPolling(true);
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
      setWrite(info.request.wants_write && info.request.verified_ai != null);
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
  const recovering = mode === "recover" && (view.kind === "signIn" || view.kind === "recover");
  const canWrite = request ? request.wants_write : true;

  return (
    <>
      {view.kind === "signIn" && !recovering && (
        <>
          <h1 className={styles.title}>{heading}</h1>
          <Asking label={label} />
          <p className={styles.lede}>Sign in, and Amber Notes asks you on your iPhone or Mac.</p>
          <SignInButtons onApple={signInWithApple} busy={busy} />
          <form className={styles.form} method="post" onSubmit={submitSignIn}>
            <EmailFields email={email} password={password} onEmail={setEmail} onPassword={setPassword} />
            {failure && <p className={styles.error} role="alert">{failure}</p>}
            <button type="submit" className={styles.secondary} disabled={!ready || busy} aria-busy={busy}>
              {busy ? <><Spinner /> Signing in…</> : "Continue"}
            </button>
          </form>
          <p className={styles.small}>
            Amber Notes on this computer? <a href={universalLink(requestId)}>Open Amber Notes</a>
            <br />No account yet? <a href="/download">Get Amber Notes</a>
          </p>
        </>
      )}

      {view.kind === "working" && (
        <p className={styles.status} role="status"><Spinner /> {view.text}</p>
      )}

      {view.kind === "waiting" && (
        <>
          <h1 className={styles.title}>Check your iPhone or Mac to approve</h1>
          {number && <MatchNumber number={number} />}
          <p className={styles.lede}>Amber Notes there shows three numbers. Tap the one that matches, then Allow, and this page takes you back to finish connecting. If none of them matches, choose Don't allow.</p>
          <p className={styles.status} role="status"><Spinner /> Waiting for you to allow it on your iPhone or Mac…</p>
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
          <h1 className={styles.title}>{heading}</h1>
          {request
            ? <p className={styles.lede}>Access goes to <b>{destination(request.redirect_host, request.loopback)}</b>.
                {request.claimed_name && <> It calls itself &ldquo;{request.claimed_name}&rdquo;.</>}</p>
            : <Asking label={label} />}
          <p className={styles.note}>
            This runs our code in your browser. Your recovery key and your notes' key are used on this page only, and are never stored or sent to us.
            If this page were changed, it could read them. When you can, approve from your iPhone or Mac instead.
          </p>
          {!signedIn && <SignInButtons onApple={signInWithApple} busy={busy} />}
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
            {failure && <p className={styles.error} role="alert">{failure}</p>}
            <button type="submit" className={styles.primary} disabled={!ready || busy} aria-busy={busy}>
              {busy ? <><Spinner /> Allowing…</> : "Allow"}
            </button>
          </form>
          {signedIn && <p className={styles.small}>Signed in as {signedIn}.</p>}
          <button type="button" className={styles.link} onClick={backToDevices}>Approve on your iPhone or Mac instead</button>
        </>
      )}

      {view.kind === "leaving" && (
        <>
          <h1 className={styles.title}>{view.allowed ? "Connected" : "Not connected"}</h1>
          <p className={styles.lede} role="status"><Spinner /> Taking you back to {hostOf(view.to)}…</p>
        </>
      )}

      {view.kind === "ended" && (
        <>
          <h1 className={styles.title}>{view.title}</h1>
          <p className={styles.lede} role="alert">{view.text}</p>
          {view.retry && <button type="button" className={styles.secondary} onClick={startOver}>Try again</button>}
        </>
      )}
    </>
  );
}

/// The signed-in account, from a Supabase Auth token response.
function sessionFrom(body: { access_token?: unknown; user?: { id?: unknown; email?: unknown } } | null, fallbackEmail: string): Session | null {
  if (typeof body?.access_token !== "string" || typeof body.user?.id !== "string") return null;
  return { token: body.access_token, userId: body.user.id, email: typeof body.user.email === "string" ? body.user.email : fallbackEmail };
}

/// The two digits the device asks you to pick out of three (matchNumber of this page's key and the request).
export function MatchNumber({ number }: { number: string }) {
  return (
    <div className={styles.match}>
      <span className={styles.matchNumber} aria-hidden="true">{number}</span>
      <p className={styles.matchText}>Tap {number} on your iPhone or Mac</p>
    </div>
  );
}

/// What the app calls itself and where access goes, never as a title: nothing here is verified.
function Asking({ label }: { label: ConnectLabel | null }) {
  if (!label) return null;
  const to = label.redirect_host ? destination(label.redirect_host, label.loopback) : null;
  return (
    <p className={styles.lede}>
      {label.claimed_name && <>It calls itself &ldquo;{label.claimed_name}&rdquo;. </>}
      {to && <>Access goes to <b>{to}</b>.</>}
    </p>
  );
}

function hostOf(url: string): string {
  try { return new URL(url).hostname || "the app"; } catch { return "the app"; }
}

function SignInButtons({ onApple, busy }: { onApple: () => void; busy: boolean }) {
  return (
    <>
      <button type="button" className={styles.apple} onClick={onApple} disabled={busy}>
        <AppleGlyph /> Sign in with Apple
      </button>
      <div className={styles.or}><span>or with email</span></div>
    </>
  );
}

/// No name attributes and a POST, and the CSP's form-action 'none': before the page's script runs,
/// the form can't put the password anywhere. The buttons wait for the script anyway.
function EmailFields({ email, password, onEmail, onPassword }: {
  email: string; password: string; onEmail: (v: string) => void; onPassword: (v: string) => void;
}) {
  return (
    <>
      <label className={styles.field}>
        <span>Email</span>
        <input type="email" id="connect-email" autoComplete="username" required value={email} onChange={(e) => onEmail(e.target.value)} />
      </label>
      <label className={styles.field}>
        <span>Password</span>
        <input type="password" id="connect-password" autoComplete="current-password" required value={password} onChange={(e) => onPassword(e.target.value)} />
      </label>
    </>
  );
}

function Spinner() {
  return <span className={styles.spinner} aria-hidden="true" />;
}

function AppleGlyph() {
  return (
    <svg width="16" height="19" viewBox="0 0 17 20" fill="currentColor" aria-hidden="true">
      <path d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4.1zM11.6 3c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5z" />
    </svg>
  );
}
