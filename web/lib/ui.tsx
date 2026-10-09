import { PasswordInput } from "./PasswordInput";
import s from "./ui.module.css";

/// The functional pages' shared parts: the pages a link lands on, a shared note's chrome, the report
/// form and the not-found pages. Styles are in ui.module.css and use the site's theme tokens.

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

/// A whole page without the site's header and footer.
export function Shell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx(s.shell, className)}>{children}</div>;
}

/// The quiet top bar: the logo, and at most one thing to do at its right end.
export function TopBar({ href = "/", children }: { href?: string; children?: React.ReactNode }) {
  return (
    <header className={s.bar}>
      <div className={s.barRow}>
        <a href={href} className={s.brand} aria-label="Pinto Notes">
          <img src="/mark-256.png" alt="" width={28} height={28} />
          <span>Pinto Notes</span>
        </a>
        {children && <div className={s.barEnd}>{children}</div>}
      </div>
    </header>
  );
}

/// Where a page's one card sits. `inSite` is for pages inside the site's header and footer.
export function Stage({ children, inSite }: { children: React.ReactNode; inSite?: boolean }) {
  const Tag = inSite ? "div" : "main";
  return <Tag className={cx(s.stage, inSite && s.stageInSite)}>{children}</Tag>;
}

export function Card({ children, form, wide, className }: { children: React.ReactNode; form?: boolean; wide?: boolean; className?: string }) {
  return <div className={cx(s.card, form && s.cardForm, wide && s.cardWide, className)}>{children}</div>;
}

export function Mark({ size = 56 }: { size?: number }) {
  return <img className={s.mark} src="/mark-256.png" alt="" width={size} height={size} />;
}

/// A row of buttons; give them the `primary`, `secondary` or `quiet` class from ui.module.css.
export function ButtonRow({ children }: { children: React.ReactNode }) {
  return <div className={s.actions}>{children}</div>;
}

/// A page that has nothing to show: the mark, what happened, what to do about it.
export function EmptyState({ title, children, actions, sign }: { title: string; children: React.ReactNode; actions?: React.ReactNode; sign?: React.ReactNode }) {
  return (
    <Card>
      {sign ?? <Mark />}
      <div className={s.group}>
        <h1 className={s.title}>{title}</h1>
        <p className={s.lede}>{children}</p>
      </div>
      {actions}
    </Card>
  );
}

type Control = { id: string; name: string; label: string; optional?: string; hint?: string; error?: string };
type InputProps = Control & Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "name"> & { multiline?: false };
type AreaProps = Control & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "name"> & { multiline: true };

function withoutType({ type: _, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return rest;
}

/// A labelled field. The label always shows; an error is said under the field it is about. A
/// password field gets the eye button that shows what is typed.
export function Field(props: InputProps | AreaProps) {
  const { id, name, label, optional, hint, error, multiline, ...rest } = props;
  const described = error ? { "aria-invalid": true, "aria-describedby": `${id}-error` } : hint ? { "aria-describedby": `${id}-hint` } : {};
  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={id}>{label}{optional && <span className={s.optional}> {optional}</span>}</label>
      {multiline
        ? <textarea className={s.input} id={id} name={name} {...described} {...(rest as React.TextareaHTMLAttributes<HTMLTextAreaElement>)} />
        : (rest as React.InputHTMLAttributes<HTMLInputElement>).type === "password"
          ? <PasswordInput className={s.input} id={id} name={name} {...described} {...withoutType(rest as React.InputHTMLAttributes<HTMLInputElement>)} />
          : <input className={s.input} id={id} name={name} {...described} {...(rest as React.InputHTMLAttributes<HTMLInputElement>)} />}
      {error
        ? <p className={s.error} id={`${id}-error`} role="status">{error}</p>
        : hint && <p className={s.hint} id={`${id}-hint`}>{hint}</p>}
    </div>
  );
}

/// What just happened, said in the card. "warn" for something the visitor has to act on.
export function Status({ title, children, tone = "info" }: { title: string; children: React.ReactNode; tone?: "info" | "warn" }) {
  return (
    <div className={s.status} data-tone={tone} role="status">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="9" cy="9" r="7.2" /><path d="M9 5.2v4.4M9 12.6v.1" /></svg>
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}

/// The round sign above an outcome's title.
export function Sign({ kind }: { kind: "done" | "gone" }) {
  return (
    <span className={s.sign} aria-hidden="true">
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        {kind === "done" ? <path d="m6.5 13.5 4.5 4.5 8.5-10" /> : <path d="M7 13h12" />}
      </svg>
    </span>
  );
}

export function Foot({ children }: { children: React.ReactNode }) {
  return <footer className={s.foot}>{children}</footer>;
}

export { s as ui };
