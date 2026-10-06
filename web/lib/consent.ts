// The cookie banner (app/ConsentBanner.tsx). Until a visitor accepts, PostHog stays cookieless and
// keeps nothing in the browser (lib/posthog.ts). Accepting lets it keep one first-party cookie, so
// a return visit is recognised for up to a year; rejecting, or never answering, changes nothing.
// The answer itself is kept in localStorage under CONSENT_KEY, which PostHog reads and writes as
// its own consent state (consent_persistence_name). Do Not Track and Global Privacy Control count
// as a rejection, and the banner doesn't ask.

export const CONSENT_KEY = "amber_consent";

/// How long PostHog's cookie lasts after an accepted visit, in days. The privacy policy says a year.
export const CONSENT_COOKIE_DAYS = 365;

/// The footer's Cookie settings link sends this to open the banner again.
export const CONSENT_OPEN_EVENT = "amber:cookie-settings";

export type ConsentChoice = "accepted" | "rejected";

/// The visitor's stored answer, or null when they haven't given one. PostHog writes 1 or 0.
export function storedChoice(value: string | null | undefined): ConsentChoice | null {
  if (value === "1" || value === "true") return "accepted";
  if (value === "0" || value === "false") return "rejected";
  return null;
}

/// Whether the banner asks on its own: only on pages PostHog may run on, to a visitor without
/// Do Not Track or Global Privacy Control who hasn't answered yet.
export function bannerAsks(allowed: boolean, optedOut: boolean, choice: ConsentChoice | null): boolean {
  return allowed && !optedOut && choice === null;
}
