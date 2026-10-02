import { useEffect, useRef, useState } from "react";
import { APPLE_ON_WEB } from "@/lib/connect";
import { afterCheck, emailLooksValid, parseEmailStatus, type Devices, type EmailStatus, type EmailStep, type Lead } from "@/lib/connect-flow";
import { APP_STORE_LIVE, APP_STORE_URL } from "@/lib/site";
import { DeviceScreen } from "./DeviceLead";
import { QRCode } from "./QRCode";
import styles from "./connect.module.css";

// What the connect page shows, one screen per state, from props only. ConnectFlow does the work and
// picks the screen; /connect/preview shows each one without a network. See lib/connect.ts.

/// While Sign in with Apple is off on the web (APPLE_ON_WEB), what Apple accounts do instead.
export const APPLE_INSTEAD = "Signed up with Apple? Scan the code with your iPhone instead.";

/// The question in your head, in one line: where access would go and what it could do. Where it
/// goes, never who is asking as a fact: nothing here is verified, so the name is only what the app
/// calls itself.
export function RequestLine({ to, claimed = null }: { to: string | null; claimed?: string | null }) {
  if (!to && !claimed) return null;
  return (
    <p className={styles.request}>
      {to && <>Access goes to <b>{to}</b>. </>}
      It can read your notes, and edit them if you say so.
      {claimed && <span className={styles.requestName}>It calls itself &ldquo;{claimed}&rdquo;.</span>}
    </p>
  );
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
      <QRCode link={link} label="QR code to connect with Amber Notes on your iPhone" />
      <p className={styles.hint}>Open the Camera and point it at the code.</p>
      {macLink && <a className={styles.secondary} href={macLink}>Open Amber Notes on this Mac</a>}
      <BottomLinks>
        <button type="button" className={styles.link} onClick={onNotify}>Get a notification instead</button>
        <button type="button" className={styles.link} onClick={onRecover}>No iPhone? Use your recovery key</button>
      </BottomLinks>
    </>
  );
}

export type SignInProps = {
  email: string; password: string; onEmail: (v: string) => void; onPassword: (v: string) => void;
  onApple: () => void; busy: boolean; ready: boolean; failure: string | null;
};

/// "Get a notification instead": sign in so Amber Notes knows which account's devices to ask.
export function NotifySignInScreen({ to, onSubmit, onScan, ...signIn }: SignInProps & {
  to: string | null; onSubmit: (e: React.FormEvent) => void; onScan: () => void;
}) {
  return (
    <>
      <h1 className={styles.title}>Sign in to get a notification</h1>
      <AccessLine to={to} />
      {APPLE_ON_WEB ? <SignInButtons onApple={signIn.onApple} busy={signIn.busy} /> : <p className={styles.small}>{APPLE_INSTEAD}</p>}
      <EmailFirst {...signIn} onSubmit={onSubmit} />
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
          <h1 className={styles.title}>Open Amber Notes on your iPhone or Mac</h1>
          <p className={styles.lede}>Open the notification from Amber Notes to approve this connection.</p>
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

/// No iPhone: approve here with the recovery key. The access choice waits under Options.
export function RecoverScreen({ to, signedIn, recoveryKey, onRecoveryKey, access, onSubmit, onScan, noDevices = false, ...signIn }: SignInProps & {
  /// Signed in, and the account has no app seen lately: say why the recovery key leads.
  noDevices?: boolean;
  to: string | null; signedIn: string | null; recoveryKey: string; onRecoveryKey: (v: string) => void;
  access: Access; onSubmit: (e: React.FormEvent) => void; onScan: () => void;
}) {
  const { write, canWrite, onWrite } = access;
  const writing = write && canWrite;
  return (
    <>
      <h1 className={styles.title}>Use your recovery key</h1>
      <AccessLine to={to} />
      {noDevices && <p className={styles.lede}>No iPhone or Mac has opened Amber Notes on this account in the last 30 days, so approve this connection here with your recovery key.</p>}
      <p className={styles.note}>
        This runs our code in your browser. Your recovery key and your notes&apos; key are used on this page only, and are never stored or sent to us.
        If this page were changed, it could read them. When you can, scan the code with your iPhone instead.
      </p>
      {!signedIn && APPLE_ON_WEB && <SignInButtons onApple={signIn.onApple} busy={signIn.busy} />}
      {!signedIn && !APPLE_ON_WEB && <p className={styles.small}>{APPLE_INSTEAD}</p>}
      <form className={styles.form} method="post" onSubmit={onSubmit}>
        {signedIn ? null : <EmailFields {...signIn} />}
        <label className={styles.field}>
          <span>Recovery key</span>
          <input
            type="text" id="connect-recovery" required autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false}
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" className={styles.code}
            value={recoveryKey} onChange={(e) => onRecoveryKey(e.target.value)}
          />
        </label>
        <details className={styles.options}>
          <summary>Options</summary>
          <div className={styles.optionsBody}>
            <div className={styles.segmented} role="radiogroup" aria-label="Access">
              <button type="button" role="radio" aria-checked={writing} disabled={!canWrite} onClick={() => onWrite(true)}>Read and edit</button>
              <button type="button" role="radio" aria-checked={!writing} onClick={() => onWrite(false)}>Read only</button>
            </div>
            <p className={styles.explain}>{writing
              ? "It can search, read, create and change notes. Every change keeps the previous version."
              : "It can search and read notes, but not change them."}</p>
          </div>
        </details>
        <p className={styles.warn}>Only allow it if you just started connecting it yourself.</p>
        <ErrorLine text={signIn.failure} />
        <button type="submit" className={styles.primary} disabled={!signIn.ready || signIn.busy} aria-busy={signIn.busy}>
          {signIn.busy ? <><Spinner /> Allowing…</> : "Allow"}
        </button>
      </form>
      {signedIn && <p className={styles.small}>Signed in as {signedIn}.</p>}
      <BottomLinks>
        <button type="button" className={styles.link} onClick={onScan}>Scan the code instead</button>
      </BottomLinks>
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

export function SignInButtons({ onApple, busy }: { onApple: () => void; busy: boolean }) {
  return (
    <>
      <button type="button" className={styles.apple} onClick={onApple} disabled={busy}>
        <AppleGlyph /> Sign in with Apple
      </button>
      <div className={styles.or}><span>or with email</span></div>
    </>
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
/// An Apple account: Sign in with Apple, above. No account: the web can't make one, because an
/// account's key is made on its first device, so the page says so and points to the app. The
/// password field is in the form from the start, so a password manager that fills both at once
/// can: Continue then signs in straight away. `onSubmit` is the page's own email and password
/// sign-in; `check` asks about the email (askEmailStatus, or a test's).
export function EmailFirst({ email, password, onEmail, onPassword, busy, ready, failure, onSubmit, check = askEmailStatus }: SignInProps & {
  onSubmit: (e: React.FormEvent) => void; check?: (email: string) => Promise<EmailStatus | null>;
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
      {step.kind === "apple" && <p className={styles.said} role="status">This email signs in with Apple. Use Sign in with Apple above.</p>}
      {step.kind === "none" ? (
        <div className={styles.said} role="status">
          <p><b>No Amber Notes account uses this email.</b></p>
          <p>Accounts start in the app on your iPhone or Mac, which makes your notes&apos; key. Get Amber Notes, sign up there, then connect again.</p>
          <a className={styles.primary} href={APP_STORE_LIVE ? APP_STORE_URL : "/download"}>Get Amber Notes</a>
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
      {(step.kind === "none" || step.kind === "apple") && (
        <button type="button" className={styles.link} onClick={differentEmail}>Use a different email</button>
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
