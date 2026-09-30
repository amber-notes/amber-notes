"use client";

import { useEffect, useState } from "react";
import { AIGlyph } from "@/lib/ai-glyphs";
import {
  appLink, appleSignInURL, destination, functionURL, pkcePair, returnURL, signInError, verifiedAI, type ConnectRequest,
} from "@/lib/connect";
import styles from "./connect.module.css";

type Session = { token: string; email: string };
type Phase =
  | { kind: "start" }
  | { kind: "inApp" }
  | { kind: "loading" }
  | { kind: "asking"; request: ConnectRequest }
  | { kind: "returning"; to: string; allowed: boolean }
  | { kind: "failed"; message: string };

/// Remembers that this browser answers in the app, so next time the app opens straight away.
const PREFER_APP = "amber.connect.app";
/// The PKCE verifier for one Sign in with Apple round trip.
const APPLE_PKCE = "amber.connect.pkce";

function remember(on: boolean) {
  try {
    if (on) localStorage.setItem(PREFER_APP, "1");
    else localStorage.removeItem(PREFER_APP);
  } catch {}
}

export default function ConnectFlow({ requestId, supabaseURL, anonKey, authCode, authError }: {
  requestId: string;
  supabaseURL: string;
  anonKey: string;
  /// Back from Sign in with Apple: Supabase's one-time code, or why it failed.
  authCode?: string;
  authError?: string;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "start" });
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signInFailure, setSignInFailure] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [write, setWrite] = useState(false);
  const [ready, setReady] = useState(false);
  const [deciding, setDeciding] = useState<"allow" | "deny" | null>(null);
  const mcp = functionURL(supabaseURL);

  useEffect(() => {
    setReady(true);
    if (authCode) {
      void finishAppleSignIn(authCode);
      return;
    }
    if (authError) {
      setSignInFailure("Sign in with Apple didn't finish. Try again.");
      window.history.replaceState(null, "", returnURL(window.location.origin, requestId));
      return;
    }
    // Someone who answered in the app before goes there again; the page stays as a way back.
    let prefers = false;
    try { prefers = localStorage.getItem(PREFER_APP) === "1"; } catch {}
    if (prefers) {
      setPhase({ kind: "inApp" });
      window.location.href = appLink(requestId);
    }
    // Runs once, for the address the page was opened with.
  }, []);

  async function signInWithApple() {
    setSigningIn(true);
    const { verifier, challenge } = await pkcePair();
    try { sessionStorage.setItem(APPLE_PKCE, JSON.stringify({ verifier, request: requestId })); } catch {}
    window.location.assign(appleSignInURL(supabaseURL, returnURL(window.location.origin, requestId), challenge));
  }

  async function finishAppleSignIn(code: string) {
    // The code leaves the address bar (and the history) before anything else happens.
    window.history.replaceState(null, "", returnURL(window.location.origin, requestId));
    let saved: { verifier?: string; request?: string } = {};
    try {
      saved = JSON.parse(sessionStorage.getItem(APPLE_PKCE) ?? "{}");
      sessionStorage.removeItem(APPLE_PKCE);
    } catch {}
    if (!saved.verifier || saved.request !== requestId) {
      setSignInFailure("Sign in with Apple didn't finish. Try again.");
      return;
    }
    setPhase({ kind: "loading" });
    try {
      const res = await fetch(`${supabaseURL}/auth/v1/token?grant_type=pkce`, {
        method: "POST",
        headers: { apikey: anonKey, "content-type": "application/json" },
        body: JSON.stringify({ auth_code: code, code_verifier: saved.verifier }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.access_token) {
        setPhase({ kind: "start" });
        setSignInFailure("Sign in with Apple didn't finish. Try again.");
        return;
      }
      remember(false);
      const s = { token: body.access_token as string, email: (body.user?.email as string | undefined) ?? "your Apple ID" };
      setSession(s);
      await load(s);
    } catch {
      setPhase({ kind: "start" });
      setSignInFailure("Couldn't sign in. Check your connection and try again.");
    }
  }

  const openApp = () => {
    remember(true);
    setPhase({ kind: "inApp" });
  };

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setSigningIn(true);
    setSignInFailure(null);
    try {
      const res = await fetch(`${supabaseURL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: anonKey, "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.access_token) {
        setSignInFailure(signInError(res.status, body));
        return;
      }
      setPassword("");
      remember(false);
      const s = { token: body.access_token as string, email: (body.user?.email as string | undefined) ?? email.trim() };
      setSession(s);
      await load(s);
    } catch {
      setSignInFailure("Couldn't sign in. Check your connection and try again.");
    } finally {
      setSigningIn(false);
    }
  }

  async function load(s: Session) {
    setPhase({ kind: "loading" });
    try {
      const res = await fetch(`${mcp}/connect/request?id=${requestId}`, { headers: { authorization: `Bearer ${s.token}` } });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setPhase({ kind: "failed", message: body?.error ?? "Couldn't reach Amber Notes. Try again." });
        return;
      }
      // An app Amber Notes can't vouch for starts at Read Only; the person can still pick more.
      setWrite(Boolean(body.wants_write) && verifiedAI(body) !== null);
      setPhase({ kind: "asking", request: body as ConnectRequest });
    } catch {
      setPhase({ kind: "failed", message: "Couldn't reach Amber Notes. Check your connection and try again." });
    }
  }

  async function decide(r: ConnectRequest, allow: boolean) {
    if (!session || deciding) return;
    setDeciding(allow ? "allow" : "deny");
    try {
      const res = await fetch(`${mcp}/connect/decide`, {
        method: "POST",
        headers: { authorization: `Bearer ${session.token}`, "content-type": "application/json" },
        body: JSON.stringify({ id: r.id, allow, write: allow && write && r.wants_write }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || typeof body?.redirect !== "string") {
        setPhase({ kind: "failed", message: body?.error ?? "Couldn't reach Amber Notes. Try again." });
        return;
      }
      // The web session was only for this answer: end it before leaving.
      await signOut(session.token);
      setPhase({ kind: "returning", to: body.redirect, allowed: allow });
      window.location.assign(body.redirect);
    } catch {
      setPhase({ kind: "failed", message: "Couldn't reach Amber Notes. Check your connection and try again." });
    } finally {
      setDeciding(null);
    }
  }

  async function signOut(token: string) {
    const ended = fetch(`${supabaseURL}/auth/v1/logout?scope=local`, {
      method: "POST",
      headers: { apikey: anonKey, authorization: `Bearer ${token}` },
    }).catch(() => undefined);
    await Promise.race([ended, new Promise((r) => setTimeout(r, 1500))]);
  }

  // The request belongs to the account that opened it, so it's let go before another signs in.
  const switchAccount = async () => {
    if (session) {
      await fetch(`${mcp}/connect/release`, {
        method: "POST",
        headers: { authorization: `Bearer ${session.token}`, "content-type": "application/json" },
        body: JSON.stringify({ id: requestId }),
      }).catch(() => undefined);
      await signOut(session.token);
    }
    setSession(null);
    setPhase({ kind: "start" });
  };

  const asking = phase.kind === "asking" ? phase.request : null;
  const ai = asking ? verifiedAI(asking) : null;
  // Who's asking: the AI, when its pinned callback proves it; otherwise where access goes, with the
  // name the app gave itself only as a claim.
  const who = asking ? (ai ?? destination(asking.redirect_host, asking.loopback)) : "";
  const claimed = asking && !ai && asking.client_name !== who ? asking.client_name : null;

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.marks} aria-hidden="true">
          {asking && (
            <>
              <span className={styles.tile}>
                {ai ? <AIGlyph name={ai === "Claude" ? "claude" : "openai"} size={30} color={ai === "Claude" ? "#d97757" : "#111"} /> : <Globe />}
              </span>
              <LinkGlyph />
            </>
          )}
          <img className={styles.mark} src="/mark-256.png" alt="" width={56} height={56} />
        </div>

        {phase.kind === "start" && (
          <>
            <h1 className={styles.title}>Connect an app to Amber Notes</h1>
            <p className={styles.lede}>An app asked to use your notes. Answer in Amber Notes, or sign in here.</p>
            <a className={styles.primary} href={appLink(requestId)} onClick={openApp}>Open in Amber Notes</a>
            <div className={styles.or}><span>or sign in here</span></div>
            <button type="button" className={styles.apple} onClick={signInWithApple} disabled={signingIn}>
              <AppleGlyph /> Sign in with Apple
            </button>
            {/* No name attributes and a POST: before the page's script runs, the form can't put the
                password in an address. The button waits for the script anyway. */}
            <form className={styles.form} method="post" onSubmit={signIn}>
              <label className={styles.field}>
                <span>Email</span>
                <input type="email" id="connect-email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className={styles.field}>
                <span>Password</span>
                <input type="password" id="connect-password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              {signInFailure && <p className={styles.error} role="alert">{signInFailure}</p>}
              <button type="submit" className={styles.secondary} disabled={!ready || signingIn} aria-busy={signingIn}>
                {signingIn ? <><Spinner /> Signing in…</> : "Sign in"}
              </button>
            </form>
            <p className={styles.small}>
              No account yet? <a href="/download">Get Amber Notes</a>.
            </p>
          </>
        )}

        {phase.kind === "inApp" && (
          <>
            <h1 className={styles.title}>Finish in Amber Notes</h1>
            <p className={styles.lede}>Choose Allow in the app. It sends you back when you're done, and you can close this page.</p>
            <a className={styles.primary} href={appLink(requestId)}>Open Amber Notes again</a>
            <button type="button" className={styles.link} onClick={() => { remember(false); setPhase({ kind: "start" }); }}>
              Sign in on the web instead
            </button>
          </>
        )}

        {phase.kind === "loading" && (
          <p className={styles.status} role="status"><Spinner /> Loading…</p>
        )}

        {asking && (
          <>
            <h1 className={styles.title}>Allow {who} to use your notes?</h1>
            {ai
              ? <p className={styles.lede}>Access goes to <b>{asking.redirect_host}</b>.</p>
              : <p className={styles.lede}>Access goes to <b>{who}</b>.{claimed && <> It calls itself &ldquo;{claimed}&rdquo;.</>}</p>}
            <div className={styles.segmented} role="radiogroup" aria-label="Access">
              <button type="button" role="radio" aria-checked={write && asking.wants_write} disabled={!asking.wants_write} onClick={() => setWrite(true)}>Read and Edit</button>
              <button type="button" role="radio" aria-checked={!(write && asking.wants_write)} onClick={() => setWrite(false)}>Read Only</button>
            </div>
            <p className={styles.explain}>
              {write && asking.wants_write
                ? "It can search, read, create and change notes. Every change keeps the previous version."
                : "It can search and read notes, but not change them."}
            </p>
            <p className={ai ? styles.note : styles.warn}>
              {ai
                ? `Only allow this if you just started connecting ${ai}.`
                : "Amber Notes doesn't recognize this app. Only allow it if you just started connecting it yourself."}
            </p>
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} disabled={deciding !== null} onClick={() => decide(asking, false)}>
                {deciding === "deny" ? <Spinner /> : null}Don't Allow
              </button>
              <button type="button" className={styles.primary} disabled={deciding !== null} onClick={() => decide(asking, true)}>
                {deciding === "allow" ? <Spinner /> : null}Allow
              </button>
            </div>
            {session && (
              <p className={styles.small}>
                Signed in as {session.email}. <button type="button" className={styles.inlineLink} onClick={switchAccount}>Use another account</button>
              </p>
            )}
          </>
        )}

        {phase.kind === "returning" && (
          <>
            <h1 className={styles.title}>{phase.allowed ? "Connected" : "Not connected"}</h1>
            <p className={styles.lede} role="status">
              <Spinner /> Taking you back to {new URL(phase.to).hostname}…
            </p>
          </>
        )}

        {phase.kind === "failed" && (
          <>
            <h1 className={styles.title}>Couldn't connect</h1>
            <p className={styles.lede} role="alert">{phase.message}</p>
            {session && (
              <button type="button" className={styles.secondary} onClick={() => load(session)}>Try again</button>
            )}
          </>
        )}
      </div>
      <p className={styles.foot}>
        <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/support">Support</a>
      </p>
    </main>
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

function Globe() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
    </svg>
  );
}

function LinkGlyph() {
  return (
    <svg className={styles.link2} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
    </svg>
  );
}
