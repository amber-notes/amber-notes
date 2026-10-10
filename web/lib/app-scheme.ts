// The app's URL scheme: ambernotes, or ambernotes-beta on the staging site, whose links open
// Amber Notes Beta (docs/Technical/staging.md). Set at build time by NEXT_PUBLIC_APP_SCHEME.
export const APP_SCHEME = /^[a-z][a-z0-9-]*$/.test(process.env.NEXT_PUBLIC_APP_SCHEME ?? "") ? process.env.NEXT_PUBLIC_APP_SCHEME! : "ambernotes";
/** Where the app's universal links live: ambernotes.app, or the staging site (NEXT_PUBLIC_APP_LINK_ORIGIN). */
export const APP_LINK_ORIGIN = (process.env.NEXT_PUBLIC_APP_LINK_ORIGIN ?? "").startsWith("https://") ? process.env.NEXT_PUBLIC_APP_LINK_ORIGIN!.replace(/\/+$/, "") : "https://ambernotes.app";
/** The app's link for a path: `${APP_SCHEME}://<path>`. */
export const appURL = (path = "") => `${APP_SCHEME}://${path}`;
