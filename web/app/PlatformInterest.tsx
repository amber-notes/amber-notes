"use client";

import { MAC_DOWNLOAD_PATH } from "@/lib/downloads";
import { ASKED, markInterest } from "@/lib/platform";
import { INTEREST_CLICKED } from "@/lib/posthog";
import { APP_STORE_LIVE, APP_STORE_URL } from "@/lib/site";

/// What a visitor who can't use "Download for Mac" sees in its place. On Windows, Android or Linux:
/// one honest line and one button that counts how many people want Amber Notes there
/// (platform_interest_clicked, lib/posthog.ts: the platform and the page, nothing about the person).
/// After the click the button is a thanks, and stays one in that browser. On an iPhone or iPad:
/// where the iPhone app stands.
///
/// Every state is in the HTML the server sends. lib/platform.ts marks <html> before first paint and
/// site.css shows the one that fits, so Apple visitors never see this and nothing moves for anyone.
/// The Mac call to action it stands in for carries "pi-apple" (and "pi-not-ios" where an iPhone
/// gets its own words).
type Place = "hero" | "band" | "download" | "header";

export default function PlatformInterest({ place, className = "", style, appStoreLive = APP_STORE_LIVE }: { place: Place; className?: string; style?: React.CSSProperties; appStoreLive?: boolean }) {
  const yes = () => markInterest(document, () => localStorage);
  if (place === "header") {
    return (
      <span className="pi-ask pi-head">
        <button type="button" className="pi-open" data-event={INTEREST_CLICKED} onClick={yes}>I want it on <Name /></button>
        <span className="pi-done" role="status">Thanks, counted</span>
      </span>
    );
  }
  const group = `pi-${place} ${className}`.trim();
  return (
    <>
      <div className={`pi pi-ask ${group}`} style={style}>
        <p className="pi-line">{today(appStoreLive)} <strong>Want it on <Name />?</strong></p>
        <button type="button" className="pi-button pi-open" data-event={INTEREST_CLICKED} onClick={yes}><span>Yes, I want it on <Name /></span></button>
        <p className="pi-thanks pi-done" role="status">Thanks. We count these to decide what to build next.</p>
        {place === "download"
          ? <a className="pi-link" href={MAC_DOWNLOAD_PATH} download>Download for Mac anyway</a>
          : <a className="pi-link" href="/download">Download for Mac</a>}
      </div>
      {place !== "download" && (
        <div className={`pi pi-ios ${group}`} style={style}>
          {appStoreLive ? (
            <a className="pi-button" href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">Download for iPhone</a>
          ) : (
            <p className="pi-line"><strong>Amber Notes for iPhone is coming to the App Store soon.</strong> It's on Mac today.</p>
          )}
          <a className="pi-link" href="/download">Download for Mac</a>
        </div>
      )}
    </>
  );
}

/// Where Amber Notes runs today: true now, and right again the day the iPhone app ships.
export function today(appStoreLive: boolean): string {
  return appStoreLive ? "Amber Notes is for iPhone and Mac today." : "Amber Notes is for Mac today, with iPhone coming soon.";
}

/// The visitor's platform by name. All three are in the HTML; site.css shows theirs.
function Name() {
  return (
    <span className="pi-name">
      {ASKED.map(([platform, name]) => <span key={platform} data-on={platform}>{name}</span>)}
    </span>
  );
}
