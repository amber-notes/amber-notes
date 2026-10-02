import { ALLOW_HEADING, destination, universalLink, type ConnectLabel, type ConnectRequest } from "@/lib/connect";
import styles from "./connect.module.css";

// What the connect page shows, from props only: ConnectFlow owns the state and the network, and
// /connect/preview renders the same screens with fixed props. `design` picks a layout; "current"
// is the page as it ships, "a" | "b" | "c" are Dev-only candidates (?design= outside production).

export type Design = "current" | "a" | "b" | "c";
export const DESIGNS: readonly Design[] = ["current", "a", "b", "c"];
export const designFrom = (v: string | undefined): Design => (DESIGNS as readonly string[]).includes(v ?? "") ? (v as Design) : "current";

export type View =
  | { kind: "signIn" }
  | { kind: "working"; text: string }
  | { kind: "waiting" }
  | { kind: "recover" }
  | { kind: "leaving"; to: string; allowed: boolean }
  | { kind: "ended"; title: string; text: string; retry?: boolean };

export type ScreenHandlers = {
  apple: () => void;
  submitSignIn: (e: React.FormEvent) => void;
  submitRecovery: (e: React.FormEvent) => void;
  email: (v: string) => void;
  password: (v: string) => void;
  recoveryKey: (v: string) => void;
  write: (v: boolean) => void;
  showRecovery: () => void;
  backToDevices: () => void;
  startOver: () => void;
};

export type ScreenProps = {
  design: Design;
  view: View;
  /// The recovery key view, or signing in for it.
  recovering: boolean;
  requestId: string;
  label: ConnectLabel | null;
  request: ConnectRequest | null;
  number: string | null;
  nudge: boolean;
  signedIn: string | null;
  failure: string | null;
  busy: boolean;
  ready: boolean;
  email: string;
  password: string;
  recoveryKey: string;
  write: boolean;
  on: ScreenHandlers;
};

export default function ConnectScreen(p: ScreenProps) {
  const { view } = p;
  if (view.kind === "working") return <p className={styles.status} role="status"><Spinner /> {view.text}</p>;
  if (view.kind === "ended") {
    return (
      <>
        <h1 className={styles.title}>{view.title}</h1>
        <p className={styles.lede} role="alert">{view.text}</p>
        {view.retry && <button type="button" className={styles.secondary} onClick={p.on.startOver}>Try again</button>}
      </>
    );
  }
  if (view.kind === "leaving") {
    return (
      <>
        <h1 className={styles.title}>{view.allowed ? "Connected" : "Not connected"}</h1>
        <p className={styles.lede} role="status"><Spinner /> Taking you back to {hostOf(view.to)}…</p>
      </>
    );
  }
  if (p.design === "current") return <Current {...p} />;
  if (p.recovering) return <Recover {...p} />;
  if (view.kind === "signIn") return <SignIn {...p} />;
  if (view.kind === "waiting") return p.design === "c" ? <WaitingC {...p} /> : <WaitingAB {...p} />;
  return null;
}

// MARK: The page as it ships

function Current(p: ScreenProps) {
  const { view, label, request, number, nudge, signedIn, failure, busy, ready, requestId, on } = p;
  const heading = ALLOW_HEADING;
  const canWrite = request ? request.wants_write : true;
  const write = p.write;
  return (
    <>
      {view.kind === "signIn" && !p.recovering && (
        <>
          <h1 className={styles.title}>{heading}</h1>
          <Asking label={label} />
          <p className={styles.lede}>Sign in, and Amber Notes asks you on your iPhone or Mac.</p>
          <SignInButtons onApple={on.apple} busy={busy} />
          <form className={styles.form} method="post" onSubmit={on.submitSignIn}>
            <EmailFields email={p.email} password={p.password} onEmail={on.email} onPassword={on.password} />
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

      {view.kind === "waiting" && (
        <>
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
          <button type="button" className={styles.link} onClick={on.showRecovery}>No device nearby? Use your recovery key</button>
        </>
      )}

      {p.recovering && (
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
          {!signedIn && <SignInButtons onApple={on.apple} busy={busy} />}
          <form className={styles.form} method="post" onSubmit={on.submitRecovery}>
            {signedIn ? null : <EmailFields email={p.email} password={p.password} onEmail={on.email} onPassword={on.password} />}
            <RecoveryField value={p.recoveryKey} onChange={on.recoveryKey} />
            <div className={styles.segmented} role="radiogroup" aria-label="Access">
              <button type="button" role="radio" aria-checked={write && canWrite} disabled={!canWrite} onClick={() => on.write(true)}>Read and edit</button>
              <button type="button" role="radio" aria-checked={!(write && canWrite)} onClick={() => on.write(false)}>Read only</button>
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
          <button type="button" className={styles.link} onClick={on.backToDevices}>Approve on your iPhone or Mac instead</button>
        </>
      )}
    </>
  );
}

// MARK: Candidates A, B and C

/// Where access goes, in words: the address only. What the app calls itself is never shown as fact.
function accessTo(p: ScreenProps): string | null {
  if (p.request) return destination(p.request.redirect_host, p.request.loopback);
  if (p.label?.redirect_host) return destination(p.label.redirect_host, p.label.loopback);
  return null;
}

function SignIn(p: ScreenProps) {
  const { design, failure, busy, ready, on } = p;
  const to = accessTo(p);
  const heading = design === "a" ? "Sign in to connect"
    : design === "c" && to ? <>Give <span className={styles.host}>{to}</span> access to your notes?</>
    : ALLOW_HEADING;
  const lede = design === "a"
    ? (to && <>Access goes to <b>{to}</b>.</>)
    : design === "b"
      ? <>{to && <>Access goes to <b>{to}</b>. </>}Sign in, then approve on your phone.</>
      : <>Sign in, then approve on your iPhone or Mac.</>;
  return (
    <>
      <h1 className={styles.title}>{heading}</h1>
      {lede && <p className={styles.lede}>{lede}</p>}
      <SignInButtons onApple={on.apple} busy={busy} />
      <form className={styles.form} method="post" onSubmit={on.submitSignIn}>
        <EmailFields email={p.email} password={p.password} onEmail={on.email} onPassword={on.password} />
        {failure && <p className={styles.error} role="alert">{failure}</p>}
        <button type="submit" className={styles.secondary} disabled={!ready || busy} aria-busy={busy}>
          {busy ? <><Spinner /> Signing in…</> : "Continue"}
        </button>
      </form>
      <p className={styles.small}><a href={universalLink(p.requestId)}>Open Amber Notes instead</a></p>
    </>
  );
}

/// A and B: one screen before the number, another with it.
function WaitingAB(p: ScreenProps) {
  const { design, number, nudge, on } = p;
  const showRecovery = design === "b" || nudge;
  return (
    <>
      {number ? (
        <>
          {design === "b" && <h1 className={styles.title}>Type this number on your phone</h1>}
          <div className={styles.slot}>
            <span className={`${styles.matchNumber} ${styles.arrive}`} aria-hidden="true">{number}</span>
          </div>
          <p className={design === "a" ? styles.matchText : styles.lede} role="status">
            <span className={styles.srOnly}>Your number is {number}. </span>
            {design === "a" ? "Type it in Amber Notes on your phone." : "Then choose Allow in Amber Notes."}
          </p>
        </>
      ) : (
        <>
          <h1 className={styles.title}>Open Amber Notes on your phone</h1>
          {design === "b" && <p className={styles.lede}>A number shows here when it opens.</p>}
          <p className={styles.status} role="status"><Spinner /><span className={styles.srOnly}>Waiting for your phone</span></p>
        </>
      )}
      {showRecovery && <RecoveryLink onClick={on.showRecovery} />}
    </>
  );
}

/// C: one layout from the start. The number arrives in a slot that was always there.
function WaitingC(p: ScreenProps) {
  const { number, nudge, on } = p;
  return (
    <>
      <h1 className={styles.title}>Approve on your phone</h1>
      <div className={styles.slot}>
        {number
          ? <span className={`${styles.matchNumber} ${styles.arrive}`} aria-hidden="true">{number}</span>
          : <span className={styles.dots} aria-hidden="true"><i /><i /></span>}
      </div>
      <p className={styles.waitLine} role="status">
        {number
          ? <><span className={styles.srOnly}>Your number is {number}. </span>Type this number there</>
          : <><Spinner /> Open Amber Notes on your iPhone or Mac</>}
      </p>
      {nudge && <RecoveryLink onClick={on.showRecovery} />}
    </>
  );
}

function Recover(p: ScreenProps) {
  const { design, signedIn, failure, busy, ready, on } = p;
  const to = accessTo(p) ?? "this app";
  const canWrite = p.request ? p.request.wants_write : true;
  const write = p.write && canWrite;
  return (
    <>
      <h1 className={styles.title}>{design === "b" ? ALLOW_HEADING : "Use your recovery key"}</h1>
      <p className={styles.lede}>
        {design === "b" ? <>Access goes to <b>{to}</b>.</> : <>Allow only if you just started connecting <b>{to}</b>.</>}
      </p>
      <p className={styles.note}>Your key stays in this browser, but a changed page could read it, so approve on your phone when you can.</p>
      {!signedIn && <SignInButtons onApple={on.apple} busy={busy} />}
      <form className={styles.form} method="post" onSubmit={on.submitRecovery}>
        {signedIn ? null : <EmailFields email={p.email} password={p.password} onEmail={on.email} onPassword={on.password} />}
        <RecoveryField value={p.recoveryKey} onChange={on.recoveryKey} />
        <details className={styles.options}>
          <summary>Options <span>{write ? "Read and edit" : "Read only"}</span></summary>
          <div className={styles.segmented} role="radiogroup" aria-label="Access">
            <button type="button" role="radio" aria-checked={write} disabled={!canWrite} onClick={() => on.write(true)}>Read and edit</button>
            <button type="button" role="radio" aria-checked={!write} onClick={() => on.write(false)}>Read only</button>
          </div>
          <p className={styles.explainShort}>{write
            ? "It can search, read, create and change notes. Every change keeps the previous version."
            : "It can search and read notes, but not change them."}</p>
        </details>
        {design === "b" && <p className={styles.warn}>Only allow it if you just started connecting it yourself.</p>}
        {failure && <p className={styles.error} role="alert">{failure}</p>}
        <button type="submit" className={styles.primary} disabled={!ready || busy} aria-busy={busy}>
          {busy ? <><Spinner /> Allowing…</> : "Allow"}
        </button>
      </form>
      {signedIn && <p className={styles.small}>Signed in as {signedIn}.</p>}
      <button type="button" className={styles.link} onClick={on.backToDevices}>Approve on your phone instead</button>
    </>
  );
}

// MARK: Pieces

function RecoveryLink({ onClick }: { onClick: () => void }) {
  return <button type="button" className={`${styles.link} ${styles.quiet}`} onClick={onClick}>No device nearby? Use your recovery key</button>;
}

function RecoveryField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className={styles.field}>
      <span>Recovery key</span>
      <input
        type="text" id="connect-recovery" required autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false}
        placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" className={styles.code}
        value={value} onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
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
