import { APP_STORE_LIVE, APP_STORE_URL } from "@/lib/site";
import CopyButton from "../templates/CopyButton";
import OpenApp from "./OpenApp";
import s from "./open.module.css";

/// Where "Use template" and "Use this note" land when the link stays in the browser. It tries the
/// app at once; if Amber Notes doesn't open within about 1.5 s, the card turns into the way to get
/// it, and, for a template, the prompt to use it with ChatGPT or Claude instead.
export default function OpenCard({ href, what, lede, markdown, prompt, back }: {
  href: string;
  /// What's being added, for the headings ("this template", "this note").
  what: string;
  lede: React.ReactNode;
  markdown: string;
  /// A template's prompt: the way to use it without the app.
  prompt?: string;
  back?: { href: string; label: string };
}) {
  return (
    <OpenApp href={href}>
      <div className={s.card}>
        <img className={s.mark} src="/mark-256.png" alt="" width={56} height={56} />
        <h1 className={s.title}>
          <span className={s.whenTrying}>Opening Amber Notes</span>
          <span className={s.whenOpened}>Opened in Amber Notes</span>
          <span className={s.whenFallback}>Get Amber Notes to use {what}</span>
        </h1>
        <p className={s.lede}>{lede}</p>
        <p className={`${s.status} ${s.whenTrying}`} role="status"><i className={s.dot} aria-hidden="true" />Looking for Amber Notes on this device</p>

        <div className={`${s.stack} ${s.whenFallback}`}>
          <a className={s.primary} href="/download/mac"><AppleGlyph /> Get Amber Notes for Mac</a>
          {APP_STORE_LIVE
            ? <a className={s.secondary} href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">Get it for iPhone</a>
            : <p className={s.soon}>iPhone app: coming soon</p>}
        </div>
        <p className={s.small}>
          <span className={s.whenFallback}>Already have it? </span>
          <span className={s.whenOpened}>Didn&apos;t open? </span>
          <a href={href}>Open Amber Notes</a>
        </p>

        <div className={`${s.alt} ${s.whenFallback}`}>
          {prompt ? (
            <details className={s.md}>
              <summary>Or use it with ChatGPT or Claude</summary>
              <p className={s.small}>Paste this into a chat with Amber Notes connected. Your AI creates the note, then fills it in.</p>
              <pre>{prompt}</pre>
              <CopyButton text={prompt} label="Copy the prompt" className={s.secondary} />
            </details>
          ) : (
            <details className={s.md}>
              <summary>Or copy it as markdown</summary>
              <p className={s.small}>The markdown pastes into Amber Notes or any notes app that reads markdown.</p>
              <pre>{markdown}</pre>
              <CopyButton text={markdown} label="Copy the markdown" className={s.secondary} />
            </details>
          )}
        </div>
        {back && <p className={s.small}><a href={back.href}>{back.label}</a></p>}
      </div>
    </OpenApp>
  );
}

const AppleGlyph = () => <svg width="14" height="17" viewBox="0 0 15 18" aria-hidden="true" fill="currentColor"><path d="M12.3 9.6c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.7.8-3.4.8-.7 0-1.8-.8-2.9-.8C3.2 4.6 1.8 5.4 1 6.8c-1.6 2.8-.4 6.9 1.1 9.1.8 1.1 1.7 2.3 2.8 2.3 1.1 0 1.6-.7 2.9-.7 1.4 0 1.7.7 2.9.7 1.2 0 2-1.1 2.7-2.2.9-1.3 1.2-2.5 1.2-2.6 0 0-2.3-.9-2.3-3.8zM10.1 3c.6-.7 1-1.7.9-2.7-.9 0-1.9.6-2.5 1.3-.6.6-1.1 1.6-.9 2.6.9.1 1.9-.5 2.5-1.2z" /></svg>;
