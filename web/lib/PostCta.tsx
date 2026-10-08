"use client";

import DownloadLink from "@/app/DownloadLink";
import { mailLink, sendLink } from "./platform";
import { APP_STORE_LIVE, APP_STORE_URL, SITE_URL } from "./site";
import s from "./post-parts.module.css";

/// A post's one call to action, at the end of its "How Amber Notes helps" section. Every link in it
/// names the post, where in the post it sits and what it does (data-cta…), and lib/posthog.ts sends
/// that as blog_cta_clicked when it's clicked. A Mac gets the download, which also counts as
/// download_mac_clicked with the post's path. An iPhone is told where the iPhone app stands, and
/// anyone else that Amber Notes is for iPhone and Mac; both can send themselves the link. The page
/// says which before first paint (lib/platform.ts), so nothing flashes or moves.
export function PostCta({ slug, position, title, children, appStoreLive = APP_STORE_LIVE }: {
  slug: string; position: string; title: string; children: React.ReactNode; appStoreLive?: boolean;
}) {
  const cta = (action: string) => ({ "data-cta": slug, "data-cta-position": position, "data-cta-action": action });
  const url = `${SITE_URL}/blog/${slug}`;
  const send = (
    <a className="pi-send" href={mailLink(url)} onClick={(e) => sendLink(navigator, e, url)} {...cta("send_link")}>Send myself the link</a>
  );
  return (
    <div className={s.cta}>
      <p className={s.ctaTitle}>{title}</p>
      {children}
      <DownloadLink className={`${s.ctaButton} pi-apple pi-not-ios`} {...cta("download_mac")}>Download Pinto Notes for Mac</DownloadLink>
      <div className="pi pi-ios">
        {appStoreLive ? (
          <a className={s.ctaButton} href={APP_STORE_URL} target="_blank" rel="noopener noreferrer" {...cta("app_store")}>Download for iPhone</a>
        ) : (
          <>
            <p className="pi-line"><strong>The iPhone app is coming to the App Store soon.</strong> Pinto Notes is on Mac today: send yourself the link to open there.</p>
            {send}
          </>
        )}
      </div>
      <div className="pi pi-other">
        <p className="pi-line"><strong>Pinto Notes is for iPhone and Mac.</strong> Send yourself the link to open on one.</p>
        {send}
      </div>
      <p className={s.ctaFine}>Free, for macOS 26 or later. Importing from Apple Notes only reads it; nothing there changes.</p>
    </div>
  );
}
