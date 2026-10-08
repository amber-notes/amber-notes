"use client";

import { useEffect, useRef, useState } from "react";
import {
  universalLink, oauthSignInURL, didntFinish, type OAuthProvider, destination, functionURL, pkcePair, returnURL, signInError, startsWithWrite,
  type ConnectLabel, type ConnectRequest,
} from "@/lib/connect";
import {
  browserOn, leadFor, parseDevices, resendRequest, type Devices, type Lead,
  browserFrom, isMacBrowser, keyFingerprint, newPageNonce, newPickup, newScan, pageCommit, pageNumber, parseKeyRow, recoveryApproval, RecoveryError,
  revealRequest, scanAppLink, scanLink, scanRequest, sealedDestination, statusRequest, statusStep, withCode,
  type AccountKey,
} from "@/lib/connect-flow";
import { newHandoffKeys, openHandoff, parseRecoveryKey, toBase64 } from "@/lib/e2ee";
import {
  EndedScreen, LeavingScreen, NotifyScreen, NotifySignInScreen, RecoverScreen, ScanScreen, WorkingScreen,
} from "./ConnectScreens";

// The connect page in the browser. See lib/connect.ts for the whole flow.

type Session = { token: string; userId: string; email: string };
type View =
  | { kind: "scan" }
  | { kind: "notifySignIn" }
  | { kind: "working"; text: string }
  | { kind: "notify" }
  | { kind: "recover" }
  | { kind: "leaving"; to: string; allowed: boolean }
  | { kind: "ended"; title: string; text: string; retry?: boolean };

/// The PKCE verifier for one Sign in with Apple or Google round trip, and which one: the only thing
/// the page ever stores.
const OAUTH_PKCE = "amber.connect.pkce";
export const POLL_MS = 2000;
const OFFLINE = "Couldn't reach Amber Notes. Check your connection and try again.";
const EXPIRED: View = { kind: "ended", title: "This request has expired", text: "Start connecting again from ChatGPT, Claude or the other app you were using." };
const LOST: View = { kind: "ended", title: "Couldn't finish here", text: "Start connecting again from the other app." };

export default function ConnectFlow({ requestId, supabaseURL, anonKey, label, recover, authCode, authError, keepQR = false, pollMs = POLL_MS }: {
  requestId: string;
  supabaseURL: string;
  anonKey: string;
  label: ConnectLabel | null;
  /// Back from Sign in with Apple or Google started on the recovery key view.
  recover: boolean;
  /// Back from Sign in with Apple or Google: Supabase's one-time code, or why it failed.
  authCode?: string;
  authError?: string;
  /// Shown through ?qr=1 before the QR page is public: the address keeps it through a sign-in.
  keepQR?: boolean;
  /// How often /connect/status is asked (tests make it short).
  pollMs?: number;
}) {
  const [view, setView] = useState<View>(authCode ? { kind: "working", text: "Signing in…" } : recover ? { kind: "recover" } : { kind: "scan" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [write, setWrite] = useState(true);
  const [request, setRequest] = useState<ConnectRequest | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [polling, setPolling] = useState(false);
  /// What the QR code encodes, and the same for the app on this Mac (null elsewhere).
  const [link, setLink] = useState<string | null>(null);
  const [macLink, setMacLink] = useState<string | null>(null);
  // Where the account has Amber Notes (from /connect/ask), and so the one device the page names.
  const [devices, setDevices] = useState<Devices | null>(null);
  const [lead, setLead] = useState<Lead>("any");
  // Kept out of React state: the session and the key pair live in this page's memory only.
  const session = useRef<Session | null>(null);
  const [signedIn, setSignedIn] = useState<string | null>(null);
  const handoffKey = useRef<CryptoKey | null>(null);
  const publicRaw = useRef<Uint8Array<ArrayBuffer> | null>(null);
  /// The pickup secret and its hash: /connect/status hands the answer only to it. The QR code and a
  /// notification share it, and the page's key.
  const pickup = useRef<{ pickup: string; pickup_hash: string } | null>(null);
  /// The page's nonce Np, for a notification only, and whether it has gone to /connect/reveal (once).
  const pageNonce = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const revealed = useRef(false);
  /// The two digits to compare with the device, once the device's nonce is in and Np is revealed.
  const [number, setNumber] = useState<string | null>(null);
  const expiresAt = useRef<number | null>(null);
  const finished = useRef(false);
  const mcp = functionURL(supabaseURL);
  const base = supabaseURL.replace(/\/+$/, "");
  const to = label?.redirect_host ? destination(label.redirect_host, label.loopback) : null;

  useEffect(() => {
    setReady(true);
    void (async () => {
      const ok = await prepare();
      if (authCode) {
        if (ok) await finishOAuthSignIn(authCode);
        else window.history.replaceState(null, "", returnURL(window.location.origin, requestId, recover, keepQR));
      } else if (authError) {
        setFailure(didntFinish(takeSaved().provider));
        window.history.replaceState(null, "", returnURL(window.location.origin, requestId, recover, keepQR));
        if (ok && !recover) setView({ kind: "notifySignIn" });
      }
    })();
    // A closed or reloaded page ends a session it still holds.
    const closing = () => { if (session.current) void signOut(session.current.token, true); };
    window.addEventListener("pagehide", closing);
    return () => window.removeEventListener("pagehide", closing);
    // Runs once, for the address the page was opened with.
  }, []);

  // Waiting for an answer: /connect/status every two seconds until there's one or it expires.
  useEffect(() => {
    if (!polling) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stopped || finished.current) return;
      let body: unknown = null;
      try {
        const secret = pickup.current?.pickup;
        if (secret) {
          const res = await fetch(...statusRequest(mcp, requestId, secret));
          if (res.ok) body = await res.json();
        }
      } catch {}
      if (stopped || finished.current) return;
      const step = statusStep(body, Date.now(), expiresAt.current);
      switch (step.kind) {
        case "wait":
          timer = setTimeout(tick, pollMs);
          return;
        case "deviceReady": {
          // A notified device opened the request and committed to its nonce: reveal ours, once, then
          // show the number. A scanned code has no number, so there's nothing to reveal.
          const np = pageNonce.current, pub = publicRaw.current, secret = pickup.current?.pickup;
          if (!revealed.current && np && pub && secret) {
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
          timer = setTimeout(tick, pollMs);
          return;
        }
        case "approved": {
          const key = handoffKey.current;
          if (!key) return end(LOST);
          try {
            // Only where the approving device sealed it, never the answer's unsealed redirect.
            return leave(sealedDestination(await openHandoff(step.handoff, key, requestId)), true);
          } catch {
            return end(LOST);
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
    timer = setTimeout(tick, pollMs);
    return () => { stopped = true; clearTimeout(timer); };
  }, [polling]);

  function end(v: View) {
    finished.current = true;
    // The visit is over: end the sign-in it kept for the recovery key.
    if (session.current) void signOut(session.current.token, true);
    handoffKey.current = null;
    publicRaw.current = null;
    pickup.current = null;
    pageNonce.current?.fill(0);
    pageNonce.current = null;
    revealed.current = false;
    setNumber(null);
    setLink(null);
    setMacLink(null);
    setPolling(false);
    setView(v);
  }

  function leave(to: string, allowed: boolean) {
    end({ kind: "leaving", to, allowed });
    window.location.assign(to);
  }

  // MARK: The QR code

  /// Makes the page's key pair, pickup secret and scan secret, tells /connect/scan their public half
  /// and hashes, shows the code and starts waiting. False when the page can't go on.
  async function prepare(): Promise<boolean> {
    try {
      const keys = await newHandoffKeys();
      const secret = await newPickup();
      const scan = await newScan();
      const fingerprint = await keyFingerprint(keys.publicRaw);
      const res = await fetch(...scanRequest(mcp, {
        id: requestId, browser_key: toBase64(keys.publicRaw), pickup_hash: secret.pickup_hash, scan_hash: scan.scan_hash,
        from: browserFrom(navigator.userAgent),
      }));
      const body = await res.json().catch(() => null) as { expires_at?: string; error?: string } | null;
      if (!res.ok) {
        if (res.status === 404) end(EXPIRED);
        else end({ kind: "ended", title: "Couldn't connect", text: body?.error ?? OFFLINE, retry: res.status !== 429 });
        return false;
      }
      handoffKey.current = keys.privateKey;
      publicRaw.current = keys.publicRaw;
      pickup.current = secret;
      pageNonce.current = null;
      revealed.current = false;
      const t = Date.parse(body?.expires_at ?? "");
      expiresAt.current = Number.isNaN(t) ? null : t;
      setLink(scanLink(requestId, scan.scan, fingerprint));
      setMacLink(isMacBrowser(navigator.platform, navigator.userAgent, navigator.maxTouchPoints)
        ? scanAppLink(requestId, scan.scan, fingerprint) : null);
      finished.current = false;
      setPolling(true);
      return true;
    } catch {
      end({ kind: "ended", title: "Couldn't connect", text: OFFLINE, retry: true });
      return false;
    }
  }

  // MARK: Signing in

  async function signInWith(provider: OAuthProvider, recovering: boolean) {
    setBusy(true);
    const { verifier, challenge } = await pkcePair();
    try { sessionStorage.setItem(OAUTH_PKCE, JSON.stringify({ verifier, request: requestId, provider })); } catch {}
    window.location.assign(oauthSignInURL(provider, supabaseURL, returnURL(window.location.origin, requestId, recovering, keepQR), challenge));
  }

  async function finishOAuthSignIn(code: string) {
    // The code leaves the address bar (and the history) before anything else happens.
    window.history.replaceState(null, "", returnURL(window.location.origin, requestId, recover, keepQR));
    const back: View = recover ? { kind: "recover" } : { kind: "notifySignIn" };
    const saved = takeSaved();
    if (!saved.verifier || saved.request !== requestId) {
      setView(back);
      setFailure(didntFinish(saved.provider));
      return;
    }
    try {
      const res = await fetch(`${base}/auth/v1/token?grant_type=pkce`, {
        method: "POST",
        headers: { apikey: anonKey, "content-type": "application/json" },
        body: JSON.stringify({ auth_code: code, code_verifier: saved.verifier }),
      });
      const s = sessionFrom(await res.json().catch(() => null), saved.provider === "google" ? "your Google account" : "your Apple ID");
      if (!res.ok || !s) {
        setView(back);
        setFailure(didntFinish(saved.provider));
        return;
      }
      session.current = s;
      setSignedIn(s.email);
      if (recover) await loadRecover(s);
      else await ask(s);
    } catch {
      setView(back);
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
      if (s) {
        session.current = s;
        setSignedIn(s.email);
        await ask(s);
      }
    } catch {
      setFailure(OFFLINE);
    } finally {
      setBusy(false);
    }
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

  // MARK: A notification instead

  /// Asks the account's devices with the same key and pickup as the QR code, so the code keeps working.
  async function ask(s: Session) {
    setView({ kind: "working", text: "Asking your iPhone or Mac…" });
    const pub = publicRaw.current, secret = pickup.current;
    if (!pub || !secret || !handoffKey.current) {
      await signOut(s.token);
      return end(LOST);
    }
    const np = newPageNonce();
    try {
      const res = await fetch(`${mcp}/connect/ask`, {
        method: "POST",
        headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
        body: JSON.stringify({
          id: requestId, browser_key: toBase64(pub), pickup_hash: secret.pickup_hash, from: browserFrom(navigator.userAgent),
          match_commit: await pageCommit(pub, np),
        }),
      });
      const body = await res.json().catch(() => null) as { expires_at?: string; error?: string } | null;
      const has = res.ok ? parseDevices(body) : null;
      const next = leadFor(has, browserOn(navigator.platform, navigator.userAgent, navigator.maxTouchPoints));
      // The session stays in this page's memory until the request ends, so "Use your recovery key"
      // never asks for the password a second time (end() and pagehide sign it out).
      if (!res.ok) await signOut(s.token);
      if (!res.ok) {
        np.fill(0);
        if (res.status === 404) return end(EXPIRED);
        // A 429 can mean the account's connecting is paused for a while: the server's message says how long.
        return end({ kind: "ended", title: "Couldn't connect", text: body?.error ?? OFFLINE, retry: res.status !== 429 });
      }
      pageNonce.current?.fill(0);
      pageNonce.current = np;
      revealed.current = false;
      setNumber(null);
      const t = Date.parse(body?.expires_at ?? "");
      if (!Number.isNaN(t)) expiresAt.current = t;
      setDevices(has);
      setLead(next);
      finished.current = false;
      setPolling(true);
      if (next === "recover") return await loadRecover(s);
      setView({ kind: "notify" });
    } catch {
      np.fill(0);
      await signOut(s.token);
      end({ kind: "ended", title: "Couldn't connect", text: OFFLINE, retry: true });
    }
  }


  /// "Send it again": the server tells the account's devices once more. What went wrong, or null.
  async function resend(): Promise<string | null> {
    const secret = pickup.current?.pickup;
    if (!secret) return "Couldn't send it again. Reload this page and start over.";
    try {
      const res = await fetch(...resendRequest(mcp, requestId, secret));
      if (res.ok) return null;
      const body = await res.json().catch(() => null) as { error?: string } | null;
      return res.status === 429 && body?.error ? body.error : "Couldn't send it again. Use your recovery key instead.";
    } catch {
      return OFFLINE;
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
      const s = session.current;
      if (!s) {
        setFailure("Sign in first.");
        return;
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

  /// Back to waiting on the code or the devices, if the page still holds its key.
  function resumeWaiting() {
    if (handoffKey.current) {
      finished.current = false;
      setPolling(true);
    }
  }

  // MARK: Moving between screens

  function showNotify() {
    setFailure(null);
    setView({ kind: "notifySignIn" });
  }

  function showRecovery() {
    forget();
    setFailure(null);
    if (session.current) void loadRecover(session.current);
    else setView({ kind: "recover" });
  }

  /// The recovery key's first step when not signed in yet: sign in, then the key alone.
  async function submitRecoverSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const s = await passwordSignIn();
      if (s) {
        session.current = s;
        setSignedIn(s.email);
        await loadRecover(s);
      }
    } catch {
      setFailure(OFFLINE);
    } finally {
      setBusy(false);
    }
  }

  async function backToScan() {
    forget();
    setFailure(null);
    if (!handoffKey.current) return startOver();
    setView({ kind: "scan" });
  }

  function startOver() {
    forget();
    setFailure(null);
    finished.current = false;
    setView({ kind: "scan" });
    void prepare();
  }

  // MARK: The page

  const signIn = { email, password, onEmail: setEmail, onPassword: setPassword, busy, ready, failure };
  const canWrite = request ? request.wants_write : true;
  const recoverTo = request ? destination(request.redirect_host, request.loopback) : to;

  switch (view.kind) {
    case "scan":
      return <ScanScreen to={to} link={link} macLink={macLink} onNotify={showNotify} onRecover={showRecovery} />;
    case "notifySignIn":
      return <NotifySignInScreen {...signIn} to={to} onApple={() => signInWith("apple", false)} onGoogle={() => signInWith("google", false)} onSubmit={submitSignIn} onScan={backToScan} />;
    case "notify":
      return (
        <NotifyScreen
          number={number} onScan={backToScan} lead={lead} devices={devices} to={to}
          openLink={macLink ?? universalLink(requestId)} onRecover={showRecovery} onResend={resend}
        />
      );
    case "recover":
      return (
        <RecoverScreen
          noDevices={lead === "recover"}
          {...signIn} to={recoverTo} signedIn={signedIn} recoveryKey={recoveryKey} onRecoveryKey={setRecoveryKey}
          access={{ write, canWrite, onWrite: setWrite }} onApple={() => signInWith("apple", true)} onGoogle={() => signInWith("google", true)} onSubmit={submitRecovery} onSignIn={submitRecoverSignIn}
          other={{ label: "Scan the code instead", onClick: () => void backToScan() }}
        />
      );
    case "working":
      return <WorkingScreen text={view.text} />;
    case "leaving":
      return <LeavingScreen allowed={view.allowed} host={hostOf(view.to)} />;
    case "ended":
      return <EndedScreen title={view.title} text={view.text} onRetry={view.retry ? startOver : undefined} />;
  }
}

/// The signed-in account, from a Supabase Auth token response.
function sessionFrom(body: { access_token?: unknown; user?: { id?: unknown; email?: unknown } } | null, fallbackEmail: string): Session | null {
  if (typeof body?.access_token !== "string" || typeof body.user?.id !== "string") return null;
  return { token: body.access_token, userId: body.user.id, email: typeof body.user.email === "string" ? body.user.email : fallbackEmail };
}

function hostOf(url: string): string {
  try { return new URL(url).hostname || "the app"; } catch { return "the app"; }
}

/// The round trip's PKCE verifier, request and provider, read once and removed.
function takeSaved(): { verifier?: string; request?: string; provider?: OAuthProvider } {
  let saved: { verifier?: string; request?: string; provider?: OAuthProvider } = {};
  try {
    saved = JSON.parse(sessionStorage.getItem(OAUTH_PKCE) ?? "{}") ?? {};
  } catch {}
  try { sessionStorage.removeItem(OAUTH_PKCE); } catch {}
  return saved;
}
