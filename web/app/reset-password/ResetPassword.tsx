"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  abandon, authAPI, emailFromFragment, MIN_PASSWORD, newPending, passwordProblem, readResetLink, requestLink, savePassword,
  type Pending, type ResetAuth,
} from "@/lib/password-reset";
import { ButtonRow, Card, EmptyState, Field, Sign, ui } from "@/lib/ui";
import s from "./reset.module.css";

/// "opening": before the page has read its address (the token is in the fragment, which only the
/// browser sees), nothing is drawn.
export type Screen = "opening" | "request" | "sent" | "form" | "done" | "expired";

/// The reset page's screens: ask for a link, "check your email", choose a new password, changed,
/// and a link that no longer works (with a way to get a new one). `auth` and `send` are for tests.
export default function ResetPassword({ initial, supabaseURL, anonKey, auth, send = requestLink }: {
  initial: Screen; supabaseURL: string; anonKey: string; auth?: ResetAuth; send?: typeof requestLink;
}) {
  const api = useMemo(() => auth ?? authAPI(supabaseURL, anonKey), [auth, supabaseURL, anonKey]);
  const [screen, setScreen] = useState<Screen>(initial);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<Pending | null>(null);

  // Read the link once, then take it out of the address bar and the history: the token and an email
  // handed over from /connect stay only in this page's memory. Nothing is spent here; a mail
  // scanner that opens the page stops at this.
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const link = readResetLink(query, fragment);
    if (link.kind === "token") pending.current = newPending(link.tokenHash);
    setScreen(link.kind === "token" ? "form" : link.kind === "refused" ? "expired" : "request");
    const handed = emailFromFragment(fragment);
    if (handed) setEmail(handed);
    forgetLink();
  }, []);

  // Closed or navigated away from after the link was spent but before the password was set.
  useEffect(() => {
    const leave = () => abandon(pending.current, api);
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, [api]);

  function forgetLink() {
    if (window.location.search || window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    if (!pending.current) return setScreen("expired");
    setBusy(true);
    setError(null);
    const outcome = await savePassword(pending.current, password, api);
    setBusy(false);
    if (outcome.kind === "error") return setError(outcome.message);
    setPassword("");
    pending.current = null;
    forgetLink();
    setScreen(outcome.kind);
  }

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await send(email);
    setBusy(false);
    if (result === "sent") { forgetLink(); return setScreen("sent"); }
    setError(result === "invalid" ? "That doesn't look like an email address." : "The link couldn't be sent. Try again in a moment.");
  }

  function differentEmail() {
    setError(null);
    setScreen("request");
  }

  if (screen === "opening") return null;

  if (screen === "done") {
    return (
      <EmptyState title="Your password is changed" sign={<Sign kind="done" />}>
        <span role="status">Sign in with it on your iPhone or Mac.</span>
      </EmptyState>
    );
  }

  if (screen === "sent") {
    return (
      <EmptyState
        title="Check your email"
        sign={<Sign kind="done" />}
        actions={<button type="button" className={`${ui.quiet} ${s.plain}`} onClick={differentEmail}>Use a different email</button>}
      >
        <span role="status">If an account uses <b>{email.trim()}</b>, we&apos;ve sent it a link to choose a new password. The link works for one hour.</span>
      </EmptyState>
    );
  }

  if (screen === "form") {
    return (
      <Card form>
        <div className={ui.group}>
          <h1 className={ui.title}>Choose a new password</h1>
          <p className={ui.lede}>Your notes stay as they are. They&apos;re locked with your key, not with your password.</p>
        </div>
        <form className={ui.form} method="post" onSubmit={save} noValidate>
          <div className={s.reveal}>
            <Field
              id="password" name="password" label="New password" type={shown ? "text" : "password"} autoComplete="new-password"
              autoFocus minLength={MIN_PASSWORD} maxLength={72} required value={password}
              onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }}
              hint={`At least ${MIN_PASSWORD} characters.`} error={error ?? undefined}
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
            />
            <button
              type="button" className={s.toggle} onClick={() => setShown((v) => !v)}
              aria-controls="password" aria-label={shown ? "Hide password" : "Show password"}
            >
              {shown ? "Hide" : "Show"}
            </button>
          </div>
          <ButtonRow>
            <button type="submit" className={ui.primary} disabled={busy} aria-busy={busy}>
              {busy ? <><span className={s.spinner} aria-hidden="true" /> Saving…</> : "Save password"}
            </button>
          </ButtonRow>
        </form>
      </Card>
    );
  }

  // "request" and "expired": the same form under different words.
  const expired = screen === "expired";
  return (
    <Card form>
      {expired && <Sign kind="gone" />}
      <div className={ui.group}>
        <h1 className={ui.title}>{expired ? "This link no longer works" : "Reset your password"}</h1>
        <p className={ui.lede}>
          {expired
            ? "A reset link works once, for one hour. Type your email and we'll send a new one."
            : "Type the email you sign in with, and we'll send you a link to choose a new password."}
        </p>
      </div>
      <form className={ui.form} method="post" onSubmit={ask} noValidate>
        <Field
          id="email" name="email" label="Email" type="email" autoComplete="username" required maxLength={320} value={email}
          onChange={(e) => { setEmail(e.target.value); if (error) setError(null); }} error={error ?? undefined}
          autoCapitalize="none" autoCorrect="off" spellCheck={false}
        />
        <ButtonRow>
          <button type="submit" className={ui.primary} disabled={busy} aria-busy={busy}>
            {busy ? <><span className={s.spinner} aria-hidden="true" /> Sending…</> : expired ? "Send a new link" : "Send link"}
          </button>
        </ButtonRow>
      </form>
    </Card>
  );
}
