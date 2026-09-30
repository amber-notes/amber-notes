/// The privacy and security facts, written once for the Privacy & Security page and the home page.
/// Every sentence must be true today; docs/privacy-policy.md is the long form. When end-to-end
/// encryption for all notes ships, change FACTS, ENCRYPTION and WHO_CAN_SEE, and drop COMING: every
/// claim about encryption on the site is in this file.

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

export type Item = { label: string; text: string };

/// "What's encrypted" on the Privacy & Security page.
export const ENCRYPTION: { items: Item[]; note: string } = {
  items: [
    { label: "On the way:", text: "everything between the apps, the website and our server travels over HTTPS." },
    { label: "Where it's stored:", text: "Supabase encrypts the database and files on its disks (AES-256)." },
    { label: "Locked notes, end to end:", text: "a locked note's text is encrypted on your device with a key made from your notes password, before it's uploaded. We never get the password or the key. Its title stays readable so your list can show it. If you forget the password, nobody can recover the note." },
    { label: "Passwords and access tokens", text: "are stored only as one-way hashes." },
  ],
  note: "Notes that aren't locked are not end-to-end encrypted yet. Our server has to read them to sync them, search them and hand them to the AI apps you approve.",
};

/// "Who can see what" on the Privacy & Security page.
export const WHO_CAN_SEE: Item[] = [
  { label: "You,", text: "on every device you sign in on." },
  { label: "Us.", text: "As the people running the database (that's Emil, who makes Amber Notes), we could technically read notes that aren't locked. We use them only to store, sync and show them to you. Supabase could too, under its contract with us." },
  { label: "AI apps you approve,", text: "for the notes they ask for. They never see the text of locked notes, only their titles." },
  { label: "Anyone with the link to a note you share,", text: "until you stop sharing it. Shared pages are hidden from search engines." },
];
