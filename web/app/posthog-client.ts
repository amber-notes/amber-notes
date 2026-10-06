import type { PostHog } from "posthog-js";
import { CONSENT_KEY, type ConsentChoice } from "@/lib/consent";
import { posthogOptions, visitorOptedOut } from "@/lib/posthog";

let loading: Promise<PostHog | null> | undefined;

/// Do Not Track or Global Privacy Control in this browser.
export function browserOptedOut(): boolean {
  return visitorOptedOut(navigator as Navigator & { globalPrivacyControl?: boolean }, window as Window & { doNotTrack?: string | null });
}

/// PostHog is fetched and started once, the first time a public page asks for it, and not at all
/// for a visitor who sends Do Not Track or Global Privacy Control.
export function startPostHog(key: string, host: string): Promise<PostHog | null> {
  loading ??= browserOptedOut()
    ? Promise.resolve(null)
    // Dead clicks are a PostHog extension it would otherwise fetch from its own servers; it comes
    // with the site instead, so the page still talks to the capture endpoint only.
    : import("posthog-js/dist/dead-clicks-autocapture")
      .then(() => import("posthog-js"))
      .then(({ default: posthog }) => posthog.init(key, posthogOptions(host)) ?? posthog).catch(() => null);
  return loading;
}

/// The visitor's answer from the banner. Accepting switches PostHog from cookieless to its cookie;
/// rejecting switches it back and removes the cookie. Without PostHog (it failed to load) the
/// answer is still kept, the way PostHog would keep it.
export async function recordChoice(key: string, host: string, choice: ConsentChoice): Promise<void> {
  const posthog = await startPostHog(key, host);
  if (posthog && choice === "accepted") {
    posthog.opt_in_capturing({ captureEventName: "cookies_accepted" });
  } else if (posthog) {
    posthog.opt_out_capturing();
    posthog.capture("cookies_rejected");
    // PostHog removes its cookie, but leaves the tab's window marker in sessionStorage.
    try {
      for (const k of Object.keys(sessionStorage)) if (k.startsWith("ph_")) sessionStorage.removeItem(k);
    } catch { /* storage blocked: nothing there */ }
  } else {
    try { localStorage.setItem(CONSENT_KEY, choice === "accepted" ? "1" : "0"); } catch { /* storage blocked: asked again next visit */ }
  }
}

/// The stored answer's raw value, or null when there is none or storage is blocked.
export function readConsent(): string | null {
  try { return localStorage.getItem(CONSENT_KEY); } catch { return null; }
}
