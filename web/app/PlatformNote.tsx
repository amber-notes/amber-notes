"use client";

import { MAC_DOWNLOAD_PATH } from "@/lib/downloads";
import { mailLink, sendLink } from "@/lib/platform";
import { APP_STORE_LIVE, APP_STORE_URL, SITE_URL } from "@/lib/site";

/// What a visitor who can't use "Download for Mac" sees in its place. On Windows, Android or Linux:
/// that Amber Notes is for iPhone and Mac, and one useful thing to do about it, which is to send
/// themselves the link for a device it runs on. Nothing here says or hints that another platform
/// is coming, and nothing is counted or stored. On an iPhone or iPad: where the iPhone app stands.
///
/// Every state is in the HTML the server sends. lib/platform.ts marks <html> before first paint and
/// site.css shows the one that fits, so Apple visitors never see this and nothing moves for anyone.
/// The Mac call to action it stands in for carries "pi-apple" (and "pi-not-ios" where an iPhone
/// gets its own words).
type Place = "hero" | "band" | "download" | "header";

export default function PlatformNote({ place, className = "", style, appStoreLive = APP_STORE_LIVE }: { place: Place; className?: string; style?: React.CSSProperties; appStoreLive?: boolean }) {
  // In the header there's room for the fact alone; it leads to the page that says the rest.
  if (place === "header") return <a className="pi-head" href="/download">For iPhone and Mac</a>;
  const group = `pi-${place} ${className}`.trim();
  // From the download page they send themselves the download page.
  const url = place === "download" ? `${SITE_URL}/download` : SITE_URL;
  return (
    <>
      <div className={`pi pi-other ${group}`} style={style}>
        <p className="pi-line"><strong>Pinto Notes is for iPhone and Mac.</strong>{appStoreLive ? "" : " The iPhone app is coming to the App Store soon."}</p>
        <a className="pi-send" href={mailLink(url)} onClick={(e) => sendLink(navigator, e, url)}>Send myself the link</a>
        <p className="pi-links">
          {appStoreLive && <a className="pi-link" href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">See it on the App Store</a>}
          {place === "download"
            ? <a className="pi-link" href={MAC_DOWNLOAD_PATH} download>Download for Mac</a>
            : <a className="pi-link" href="/download">Download for Mac</a>}
        </p>
      </div>
      {place !== "download" && (
        <div className={`pi pi-ios ${group}`} style={style}>
          {appStoreLive ? (
            <a className="pi-button" href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">Download for iPhone</a>
          ) : (
            <p className="pi-line"><strong>Pinto Notes for iPhone is coming to the App Store soon.</strong> It's on Mac today.</p>
          )}
          <p className="pi-links"><a className="pi-link" href="/download">Download for Mac</a></p>
        </div>
      )}
    </>
  );
}
