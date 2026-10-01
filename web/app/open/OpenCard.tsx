import CopyButton from "../templates/CopyButton";
import OpenApp from "./OpenApp";
import s from "./open.module.css";

/// Where "Use this template" and "Use this note" land when the link stays in the browser: try the
/// app (once on load, then with the button), and otherwise get Amber Notes or take the markdown.
export default function OpenCard({ href, title, lede, markdown, back }: { href: string; title: string; lede: React.ReactNode; markdown: string; back?: { href: string; label: string } }) {
  return (
    <div className={s.page}>
      <OpenApp href={href} />
      <div className={s.card}>
        <img className={s.mark} src="/mark-256.png" alt="" width={56} height={56} />
        <h1 className={s.title}>{title}</h1>
        <p className={s.lede}>{lede}</p>
        <a className={s.primary} href={href}>Open Amber Notes</a>
        <p className={s.or}>Don&apos;t have Amber Notes?</p>
        <div className={s.pair}>
          <a className={s.secondary} href="/download">Get Amber Notes</a>
          <CopyButton text={markdown} label="Copy the markdown" className={s.secondary} />
        </div>
        <p className={s.small}>The markdown pastes into Amber Notes or any notes app that reads markdown.</p>
        <details className={s.md}>
          <summary>Show the markdown</summary>
          <pre>{markdown}</pre>
        </details>
        {back && <p className={s.small}><a href={back.href}>{back.label}</a></p>}
      </div>
    </div>
  );
}
