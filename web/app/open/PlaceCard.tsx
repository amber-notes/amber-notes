import { APP_STORE_LIVE, APP_STORE_URL } from "@/lib/site";
import { Card, Mark, ui } from "@/lib/ui";
import OpenApp from "./OpenApp";
import s from "./open.module.css";

/// Where an onboarding email's button lands when the link stays in the browser (no app here, or
/// another device). It tries the app at once; if Amber Notes doesn't open within about 1.5 s, the
/// card says how to do it by hand, with Open in Amber Notes and the downloads.
export default function PlaceCard({ href, title, lede, steps, links }: {
  /// The app's link for the place, e.g. ambernotes://connect-ai.
  href: string;
  /// What the place is, for the fallback heading ("Connect your AI").
  title: string;
  lede: React.ReactNode;
  steps: React.ReactNode[];
  links?: { href: string; label: string }[];
}) {
  return (
    <OpenApp href={href}>
      <Card className={s.anim}>
        <Mark />
        <div className={ui.group}>
          <h1 className={ui.title}>
            <span className={s.whenTrying}>Opening Pinto Notes</span>
            <span className={s.whenOpened}>Opened in Pinto Notes</span>
            <span className={s.whenFallback}>{title}</span>
          </h1>
          <p className={ui.lede}>{lede}</p>
        </div>
        <p className={`${s.status} ${s.whenTrying}`} role="status"><i className={s.dot} aria-hidden="true" />Looking for Pinto Notes on this device</p>

        <ol className={`${s.steps} ${s.whenFallback}`}>{steps.map((st, i) => <li key={i}>{st}</li>)}</ol>
        <div className={`${s.stack} ${s.whenFallback}`}>
          <a className={ui.primary} href={href}>Open in Pinto Notes</a>
          <a className={ui.secondary} href="/download/mac">Download for Mac</a>
          {APP_STORE_LIVE
            ? <a className={ui.secondary} href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">Get it for iPhone</a>
            : <p className={s.soon}>iPhone app: coming soon</p>}
        </div>
        <p className={`${ui.small} ${s.again} ${s.whenOpened}`}>Didn&apos;t open? <a href={href}>Open Pinto Notes</a></p>
        {links && links.length > 0 && (
          <p className={`${ui.small} ${s.backRow} ${s.whenFallback}`}>
            {links.map((l, i) => <span key={l.href}>{i > 0 && " · "}<a className={s.back} href={l.href}>{l.label}</a></span>)}
          </p>
        )}
      </Card>
    </OpenApp>
  );
}
