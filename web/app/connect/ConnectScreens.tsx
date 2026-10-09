import { useEffect, useRef, useState } from "react";
import { APPLE_ON_WEB, GOOGLE_ON_WEB } from "@/lib/connect";
import { afterCheck, emailLooksValid, parseEmailStatus, type Devices, type EmailStatus, type EmailStep, type Lead } from "@/lib/connect-flow";
import { APP_STORE_LIVE, APP_STORE_URL } from "@/lib/site";
import { DeviceScreen } from "./DeviceLead";
import { QRCode } from "./QRCode";
import styles from "./connect.module.css";

// What the connect page shows, one screen per state, from props only. ConnectFlow does the work and
// picks the screen; /connect/preview shows each one without a network. See lib/connect.ts.

/// An account without a password signs in with Apple or Google; which one isn't said, so the page
/// tells nobody more about an email than that it has an account.
export const NO_PASSWORD = "This email signs in with Apple or Google. Use one of the buttons above.";

/// While Sign in with Apple is off on the web (APPLE_ON_WEB), what Apple accounts do instead.
export const APPLE_INSTEAD = "Signed up with Apple? Scan the code with your iPhone instead.";

/// What the app could do, in one line under the heading. Where access goes is the page's frame's
/// to say (ConnectCard: the band on a phone, the panel beside the form on a wide screen), so it
/// isn't repeated here. `to` and `claimed` stay for the callers; nothing here verifies the name.
export function RequestLine({ to, claimed = null }: { to: string | null; claimed?: string | null }) {
  if (!to && !claimed) return null;
  return <p className={styles.request}>It can read your notes, and edit them if you say so.</p>;
}
const AccessLine = RequestLine;

/// What went wrong, in a line that is always there, so nothing below it moves when it speaks.
export function ErrorLine({ text }: { text: string | null }) {
  return <p className={styles.error} role="alert">{text}</p>;
}

/// The main screen: one QR code to scan with your iPhone. `link` is null until the code is ready;
/// `macLink` opens the app on this Mac with the same secret.
export function ScanScreen({ to, link, macLink, onNotify, onRecover }: {
  to: string | null; link: string | null; macLink: string | null; onNotify: () => void; onRecover: () => void;
}) {
  return (
    <>
      <h1 className={styles.title}>Scan with your iPhone</h1>
      <AccessLine to={to} />
      <QRCode link={link} label="QR code to connect with Pinto Notes on your iPhone" />
      <p className={styles.hint}>Open the Camera and point it at the code.</p>
      {macLink && <a className={styles.secondary} href={macLink}>Open Pinto Notes on this Mac</a>}
      <BottomLinks>
        <button type="button" className={styles.link} onClick={onNotify}>Get a notification instead</button>
        <button type="button" className={styles.link} onClick={onRecover}>No iPhone? Use your recovery key</button>
      </BottomLinks>
    </>
  );
}

export type SignInProps = {
  email: string; password: string; onEmail: (v: string) => void; onPassword: (v: string) => void;
  onApple: () => void; onGoogle?: () => void; busy: boolean; ready: boolean; failure: string | null;
};

/// "Get a notification instead": sign in so Amber Notes knows which account's devices to ask.
export function NotifySignInScreen({ to, onSubmit, onScan, ...signIn }: SignInProps & {
  to: string | null; onSubmit: (e: React.FormEvent) => void; onScan: () => void;
}) {
  return (
    <>
      <h1 className={styles.title}>Sign in to get a notification</h1>
      <AccessLine to={to} />
      {APPLE_ON_WEB ? <SignIn {...signIn} onSubmit={onSubmit} /> : (
        <>
          <p className={styles.small}>{APPLE_INSTEAD}</p>
          <EmailFirst {...signIn} onSubmit={onSubmit} />
        </>
      )}
      <BottomLinks>
        <button type="button" className={styles.link} onClick={onScan}>Scan the code instead</button>
      </BottomLinks>
    </>
  );
}

/// Waiting for the notification to be answered. Once the device has opened the request, the number
/// to compare with what it shows.
export function NotifyScreen({ number, onScan, lead = "any", devices = null, openLink = "", onRecover, onResend, to = null }: {
  number: string | null; onScan: () => void; to?: string | null; onResend?: () => Promise<string | null>;
  /// The one device to name, once /connect/ask has said where the account has the app.
  lead?: Lead; devices?: Devices | null; openLink?: string; onRecover?: () => void;
}) {
  if (devices && onRecover && lead !== "recover" && lead !== "any") {
    return (
      <DeviceScreen
        lead={lead} devices={devices} number={number} action="compare" openLink={openLink} onRecover={onRecover} onResend={onResend}
      >
        <button type="button" className={styles.link} onClick={onScan}>Scan the code instead</button>
      </DeviceScreen>
    );
  }
  return (
    <>
      {number ? (
        <>
          <h1 className={styles.title}>Compare the number</h1>
          <MatchNumber number={number} />
          <p className={styles.lede}>If the number is different, choose Don&apos;t allow.</p>
        </>
      ) : (
        <>
          <h1 className={styles.title}>Open Pinto Notes on your iPhone or Mac</h1>
          <p className={styles.lede}>Open the notification from Pinto Notes to approve this connection.</p>
        </>
      )}
      <BottomLinks>
        <button type="button" className={styles.link} onClick={onScan}>Scan the code instead</button>
      </BottomLinks>
    </>
  );
}

/// The two digits the page and the device both show (matchNumber of this page's key, both nonces
/// and the request). You compare them, then choose Allow on the device.
export function MatchNumber({ number }: { number: string }) {
  return (
    <div className={styles.match}>
      <span className={styles.matchNumber} aria-hidden="true">{number}</span>
      <p className={styles.matchText}>Check that your phone shows {number}, then choose Allow there.</p>
    </div>
  );
}

export type Access = { write: boolean; canWrite: boolean; onWrite: (write: boolean) => void };

/// No iPhone or Mac nearby: approve here with the recovery key. Two steps, never one long form:
/// sign in first (once per visit), then only the key and Allow. Access follows what the app asked for.
export function RecoverScreen({ to, signedIn, recoveryKey, onRecoveryKey, access, onSubmit, onSignIn, other, noDevices = false, appleInstead = APPLE_INSTEAD, ...signIn }: SignInProps & {
  /// What to say while Sign in with Apple is off on the web.
  appleInstead?: string;
  /// Signed in, and the account has no app seen lately: say why the recovery key leads.
  noDevices?: boolean;
  to: string | null; signedIn: string | null; recoveryKey: string; onRecoveryKey: (v: string) => void;
  access: Access; onSubmit: (e: React.FormEvent) => void; onSignIn: (e: React.FormEvent) => void;
  /// The way back to a device: "Scan the code instead" or "Approve on your iPhone or Mac instead".
  other: { label: string; onClick: () => void };
}) {
  const { write, canWrite, onWrite } = access;
  const where = to ?? "this app";
  const back = (
    <BottomLinks>
      <button type="button" className={styles.link} onClick={other.onClick}>{other.label}</button>
    </BottomLinks>
  );
  if (!signedIn) {
    return (
      <>
        <h1 className={styles.title}>Use your recovery key</h1>
        <p className={styles.lede}>Sign in first. Then enter your recovery key to allow <b>{where}</b>.</p>
        {APPLE_ON_WEB ? <SignIn {...signIn} onSubmit={onSignIn} /> : <EmailFirst {...signIn} onSubmit={onSignIn} />}
        {!APPLE_ON_WEB && <p className={styles.small}>{appleInstead}</p>}
        {back}
      </>
    );
  }
  return (
    <>
      <h1 className={styles.title}>Use your recovery key</h1>
      {noDevices && <p className={styles.lede}>No iPhone or Mac has opened Pinto Notes on this account in the last 30 days.</p>}
      <p className={styles.lede}>Enter your recovery key to allow <b>{where}</b>. Only do this if you just started connecting it yourself.</p>
      <form className={styles.form} method="post" onSubmit={onSubmit}>
        <label className={styles.field}>
          <span>Recovery key</span>
          <input
            type="text" id="connect-recovery" required autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false}
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" className={styles.code}
            value={recoveryKey} onChange={(e) => onRecoveryKey(e.target.value)}
          />
        </label>
        {canWrite && (
          <label className={styles.check}>
            <input type="checkbox" checked={!write} onChange={(e) => onWrite(!e.target.checked)} />
            <span>Read only: it can&apos;t change your notes</span>
          </label>
        )}
        <ErrorLine text={signIn.failure} />
        <button type="submit" className={styles.primary} disabled={!signIn.ready || signIn.busy} aria-busy={signIn.busy}>
          {signIn.busy ? <><Spinner /> Allowing…</> : "Allow"}
        </button>
        <p className={styles.small}>Your key is used on this page only and never sent to us. Signed in as {signedIn}.</p>
      </form>
      {back}
    </>
  );
}

export function WorkingScreen({ text }: { text: string }) {
  return <p className={styles.status} role="status"><Spinner /> {text}</p>;
}

/// After the answer: on the way back to the app.
export function LeavingScreen({ allowed, host }: { allowed: boolean; host: string }) {
  return (
    <>
      {allowed && <DoneMark />}
      <h1 className={styles.title}>{allowed ? "Connected" : "Not connected"}</h1>
      <p className={styles.status} role="status"><Spinner /> Taking you back to {host}…</p>
    </>
  );
}

export function EndedScreen({ title, text, onRetry }: { title: string; text: string; onRetry?: () => void }) {
  return (
    <>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.lede} role="alert">{text}</p>
      {onRetry && <button type="button" className={styles.secondary} onClick={onRetry}>Try again</button>}
    </>
  );
}

function BottomLinks({ children }: { children: React.ReactNode }) {
  return <div className={styles.links}>{children}</div>;
}

/// Sign in with Apple, then Sign in with Google directly under it (Apple stays first, as in the app).
export function SignInButtons({ onApple, onGoogle, busy }: { onApple: () => void; onGoogle?: () => void; busy: boolean }) {
  return (
    <>
      <button type="button" className={styles.apple} onClick={onApple} disabled={busy}>
        <AppleGlyph /> Sign in with Apple
      </button>
      {GOOGLE_ON_WEB && onGoogle && (
        <button type="button" className={styles.google} onClick={onGoogle} disabled={busy}>
          <GoogleG /> Sign in with Google
        </button>
      )}
      <div className={styles.or}><span>or with email</span></div>
    </>
  );
}

/// The ways to sign in, at one height. Once the email turns out to be the way in (its account has a
/// password, or there's no account), the Apple and Google buttons and the divider leave and the
/// email form takes their room: the password field, the button and what the form says fit where
/// the buttons were, so the card around them doesn't grow. "Other ways to sign in" brings the
/// buttons back. The height is held by a copy of the first layout's boxes that nobody can see or
/// reach, under the real one.
export function SignIn({ onSubmit, check, ...signIn }: SignInProps & {
  onSubmit: (e: React.FormEvent) => void; check?: (email: string) => Promise<EmailStatus | null>;
}) {
  // Null until the first swap, so nothing moves when the page opens.
  const [ways, setWays] = useState<"email" | "all" | null>(null);
  const live = useRef<HTMLDivElement>(null);
  const asked = useRef(false);
  const alone = ways === "email";
  useEffect(() => {
    // Back by the person's own choice: the keyboard lands on the first button that returned.
    if (!alone && asked.current) live.current?.querySelector("button")?.focus();
    asked.current = false;
  }, [alone]);
  function onAlone(next: boolean, byChoice = false) {
    if (next === alone) return;
    asked.current = byChoice;
    setWays(next ? "email" : "all");
  }
  return (
    <div className={styles.signIn}>
      <div className={styles.signInSizer} aria-hidden="true" inert>
        <div className={styles.apple} />
        {GOOGLE_ON_WEB && signIn.onGoogle && <div className={styles.google} />}
        <div className={styles.or}><span>&nbsp;</span></div>
        <div className={styles.form}>
          <div className={styles.field}>
            <span>&nbsp;</span>
            <input type="text" disabled tabIndex={-1} autoComplete="off" />
          </div>
          <p className={styles.error} />
          <div className={styles.secondary} />
        </div>
      </div>
      <div className={styles.signInLive} ref={live} data-ways={ways ?? undefined}>
        {!alone && <SignInButtons onApple={signIn.onApple} onGoogle={signIn.onGoogle} busy={signIn.busy} />}
        <EmailFirst {...signIn} onSubmit={onSubmit} check={check} alone={alone} onAlone={onAlone} />
      </div>
    </div>
  );
}

/// Asks the site whether an email has an account (app/connect/account-status). Null when it can't say.
export async function askEmailStatus(email: string): Promise<EmailStatus | null> {
  try {
    const res = await fetch("/connect/account-status", {
      method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: email.trim() }),
    });
    return res.ok ? parseEmailStatus(await res.json().catch(() => null)) : null;
  } catch {
    return null;
  }
}

/// Email first, as the app's sign-in does it (Pane/Views/EmailSignInFlow.swift): one Email field and
/// Continue; the answer decides what comes next. An account with a password: the Password field
/// opens under the email (still editable; changing it starts over) and the button becomes Sign in.
/// An account without a password (Apple or Google): the buttons above. No account: the web can't make one, because an
/// account's key is made on its first device, so the page says so and points to the app. The
/// password field is in the form from the start, so a password manager that fills both at once
/// can: Continue then signs in straight away. `onSubmit` is the page's own email and password
/// sign-in; `check` asks about the email (askEmailStatus, or a test's). Under SignIn, `onAlone` hears
/// when the form should stand alone (a password to type, or no account) or needs the buttons back
/// (the account signs in with them), and `alone` adds the way back to them.
export function EmailFirst({ email, password, onEmail, onPassword, busy, ready, failure, onSubmit, check = askEmailStatus, alone = false, onAlone }: SignInProps & {
  onSubmit: (e: React.FormEvent) => void; check?: (email: string) => Promise<EmailStatus | null>;
  alone?: boolean; onAlone?: (alone: boolean, byChoice?: boolean) => void;
}) {
  const [step, setStep] = useState<EmailStep>({ kind: "email" });
  const passwordRef = useRef<HTMLInputElement>(null);
  const open = step.kind === "password";
  useEffect(() => { if (open) passwordRef.current?.focus(); }, [open]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (open) return onSubmit(e);
    if (step.kind === "checking" || !emailLooksValid(email)) return;
    setStep({ kind: "checking" });
    const next = afterCheck(await check(email));
    setStep(next);
    onAlone?.(next.kind !== "apple");
    // Filled by a password manager along with the email: no reason to ask again.
    if (next.kind === "password" && password) onSubmit(e);
  }
  function editEmail(v: string) {
    onEmail(v);
    if (step.kind !== "email") setStep({ kind: "email" });
  }
  function differentEmail() {
    onPassword("");
    setStep({ kind: "email" });
    document.getElementById("connect-email")?.focus();
  }
  function otherWays() {
    onPassword("");
    setStep({ kind: "email" });
    onAlone?.(false, true);
  }
  const checking = step.kind === "checking";
  return (
    <form className={styles.form} method="post" onSubmit={submit}>
      <label className={styles.field}>
        <span>Email</span>
        <input type="email" id="connect-email" autoComplete="username" required value={email} onChange={(e) => editEmail(e.target.value)} readOnly={checking} />
      </label>
      <label className={open ? styles.field : `${styles.field} ${styles.waiting}`} aria-hidden={open ? undefined : true}>
        <span>Password</span>
        <input
          ref={passwordRef} type="password" id="connect-password" autoComplete="current-password" required={open} tabIndex={open ? 0 : -1}
          value={password} onChange={(e) => onPassword(e.target.value)}
        />
      </label>
      {step.kind === "apple" && <p className={styles.said} role="status">{NO_PASSWORD}</p>}
      {step.kind === "none" ? (
        <div className={styles.said} role="status">
          <p><b>No Pinto Notes account uses this email.</b></p>
          <p>Accounts start in the app on your iPhone or Mac, which makes your notes&apos; key. Get Pinto Notes, sign up there, then connect again.</p>
          <a className={styles.primary} href={APP_STORE_LIVE ? APP_STORE_URL : "/download"}>Get Pinto Notes</a>
        </div>
      ) : (
        <>
          <ErrorLine text={failure} />
          {step.kind !== "apple" && (
            <button type="submit" className={styles.secondary} disabled={!ready || busy || checking || (open ? !password : !emailLooksValid(email))} aria-busy={busy || checking}>
              {busy ? <><Spinner /> Signing in…</> : checking ? <><Spinner /> Checking…</> : open ? "Sign in" : "Continue"}
            </button>
          )}
        </>
      )}
      {(open || alone || step.kind === "none" || step.kind === "apple") && (
        <div className={styles.formLinks}>
          {/* In a new tab, so this request's page stays open; the email goes in the fragment, which reaches no server. */}
          {open && <a className={styles.link} href={`/reset-password#email=${encodeURIComponent(email.trim())}`} target="_blank" rel="noopener">Forgot password?</a>}
          {(step.kind === "none" || step.kind === "apple") && (
            <button type="button" className={styles.link} onClick={differentEmail}>Use a different email</button>
          )}
          {alone && <button type="button" className={styles.link} onClick={otherWays}>Other ways to sign in</button>}
        </div>
      )}
    </form>
  );
}

/// No name attributes and a POST, and the CSP's form-action 'none': before the page's script runs,
/// the form can't put the password anywhere. The buttons wait for the script anyway.
export function EmailFields({ email, password, onEmail, onPassword }: Pick<SignInProps, "email" | "password" | "onEmail" | "onPassword">) {
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

/// A tick on an amber disc of cut paper: it worked.
function DoneMark() {
  return (
    <svg className={styles.done} viewBox="0 0 64 64" width={64} height={64} aria-hidden="true" focusable="false">
      <circle className={styles.pShadow} cx="34" cy="35" r="26" />
      <circle className={styles.pDisc} cx="32" cy="32" r="26" />
      <path className={styles.doneTick} d="M21 33.5l7.5 7.5L43.5 25" />
    </svg>
  );
}

export function Spinner() {
  return <span className={styles.spinner} aria-hidden="true" />;
}

function AppleGlyph() {
  return (
    <svg width="16" height="19" viewBox="0 0 17 20" fill="currentColor" aria-hidden="true">
      <path d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4.1zM11.6 3c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5z" />
    </svg>
  );
}

/// Google's standard "G", in its own four colours: never recoloured or stretched.
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
