/// The privacy and security facts, written once for the Privacy & Security page and the home page.
/// Every sentence must be true today; docs/privacy-policy.md is the long form. When end-to-end
/// encryption for all notes ships, change FACTS and the page's encryption section, and drop COMING.

export const PRIVACY_PATH = "/privacy-security";

export type Fact = { title: string; text: string };

/// The short list: the home page shows these, and the page opens with them.
export const FACTS: Fact[] = [
  { title: "No ads, no tracking", text: "No ads, no tracking scripts and no third-party analytics, in the apps or on this website. The apps count a few things on our own server. We never sell or share your data." },
  { title: "Stored in the EU", text: "Your notes and files are kept in Frankfurt, Germany, encrypted on the way and where they're stored." },
  { title: "Locked notes are end-to-end encrypted", text: "Lock a note and its text is encrypted on your device with your notes password. Nobody else can read it: not us, and not an AI." },
  { title: "AI only with your approval", text: "An AI app can read your notes only after you approve it. Choose Read Only, and disconnect at any time." },
];

/// The design for end-to-end encryption of every note, in review on GitHub (PR 41). Planned, not built.
export const COMING = {
  text: "Coming: end-to-end encryption for all your notes. We're designing it in the open. Until it ships, notes that aren't locked are encrypted on the way and where they're stored, but not end to end.",
  href: "https://github.com/emilwagman/amber-notes/pull/41",
};

export type Log = { name: string; what: string; kept: string };

/// Every log that holds anything about a request, ours or our hosts'. Same as the policy's Logs section.
export const LOGS: Log[] = [
  { name: "Supabase request logs", what: "Each request to our server: the time, the address it asked for, the IP address and device type, and a rough location from the IP address.", kept: "1 day" },
  { name: "Supabase sign-in logs", what: "Each sign-in and sign-out: the time, the email address and the IP address.", kept: "1 day" },
  { name: "Supabase function and database logs", what: "When each server function ran and what it was asked for, and errors, with names, addresses and ids blanked out.", kept: "1 day" },
  { name: "Sign-in records in our database", what: "Each sign-in: the time, the email address and the IP address, to keep your account secure.", kept: "30 days" },
  { name: "Vercel request logs", what: "Each request to this website: the time, the page, the IP address and device type, and whether it worked.", kept: "1 hour" },
  { name: "Rate limits", what: "A one-way hash of the IP address, made with a key that changes every day, to stop floods of sign-in attempts.", kept: "2 hours" },
];

/// What the apps count, on our own server. Kept 12 months, never shared.
export const COUNTS: string[] = [
  "how many notes an AI connection changed on each day",
  "which days you used the app, to ask once, after a week, whether you'd like to share it",
  "which tips were shown and whether the feature was then used",
  "which first-run setup steps you've done",
  "a random id for each installation and whether it's an iPhone or a Mac, to count devices",
];
