/// The privacy and security facts, written once for the Privacy & Security page and the home page.
/// Every sentence must be true today; docs/privacy-policy.md is the long form, and
/// docs/Technical/e2ee-design.md is the model as built. Every claim about encryption on the site is
/// in this file, so the page and the home page can't say more than it does.

export const PRIVACY_PATH = "/privacy-security";

export type Fact = { title: string; text: string };

/// The short list: the home page shows these, and the page opens with them.
export const FACTS: Fact[] = [
  { title: "End-to-end encrypted", text: "Your notes, titles, folder names, files and earlier versions are encrypted on your iPhone or Mac with a key that only your devices, and AI connections you approve, can unlock. We can't read them." },
  { title: "AI only with your approval", text: "An AI app can read your notes only after you approve it on your iPhone or Mac. While it works, our server opens the notes it asks for in memory. Disconnect it at any time." },
  { title: "No ads, no tracking", text: "No ads, no tracking scripts and no third-party analytics, in the apps or on this website. The apps count a few things on our own server. We never sell or share your data." },
  { title: "Stored in the EU", text: "Your encrypted notes and files are kept in Frankfurt, Germany." },
];

/// The one line under the facts: end to end has limits, and the page lists them.
export const CAVEAT = {
  text: "End-to-end encryption has limits. When an AI you connected asks for notes, our server reads them in memory to answer it, and some details about your account stay readable to us. Here is all of it.",
  href: "#limits",
  link: "See the limits",
};

export type Item = { label: string; text: string };

/// "What's encrypted" on the Privacy & Security page.
export const ENCRYPTION: { items: Item[]; note: string } = {
  items: [
    { label: "End to end:", text: "your notes, their titles, folder names, file names and files, and every earlier version are encrypted on your device before they're uploaded. The key is made on your first device, and only your devices, and AI connections you approve, can unlock it. We store only the encrypted copies, and we can't read them." },
    { label: "Your key:", text: "iCloud Keychain carries it between your iPhone and Mac. Apple encrypts iCloud Keychain end to end, so Apple can't read it either." },
    { label: "Your recovery key:", text: "a key you save yourself, shown in Settings, Privacy & Security on your devices. It's the fallback when a device can't get your key from iCloud Keychain. We keep your notes' key only locked with it, and we never get the recovery key." },
    { label: "Locked notes:", text: "encrypted a second time, with a key made from your notes password. That key never leaves your devices, so not even an AI you connect can read a locked note's text. If you forget the password, nobody can recover it." },
    { label: "On the way and on disk:", text: "everything travels over HTTPS, and Supabase encrypts its disks as well (AES-256)." },
    { label: "Passwords and access tokens", text: "are stored only as one-way hashes." },
  ],
  note: "Signing in, with Apple or a password, only tells us who you are. Your password has nothing to do with your notes' key.",
};

/// "What stays readable to us" on the Privacy & Security page.
export const READABLE: string[] = [
  "your email address and your sign-in records",
  "your profile name and photo",
  "your notes-password hint",
  "the size and dates of each note, file and version",
  "which folder each note is in, and which notes are sub-notes of which",
  "which notes are pinned, and which are locked",
  "the names of the AI apps that edited a note",
  "your list of devices",
  "your AI connections: their names, access, and when they were made and last used",
  "the usage counts listed below",
  "a note you share, while it's shared, since anyone with the link can read it",
];

/// "When you connect an AI" on the Privacy & Security page.
export const AI_ACCESS: Item[] = [
  { label: "You approve it on your device.", text: "Your iPhone or Mac asks you, and you type the number the page you started on shows there. With no device nearby, you can approve in the browser with your recovery key." },
  { label: "Our server opens your notes for it.", text: "Approving gives that AI connection a copy of your notes' key, locked with a secret only the AI holds. During each of its requests our server unlocks your whole notes' key in memory, reads the notes the AI asks for, and forgets the key when the request ends." },
  { label: "Our hosts carry that text.", text: "For AI requests, the text of the notes the AI reads or writes, and its access tokens, pass through Vercel and Supabase in readable form on their way. Neither stores your notes." },
  { label: "Locked notes stay locked.", text: "An AI sees only their titles, never their text." },
];

/// "Limits" on the Privacy & Security page: what end to end doesn't protect against, today.
export const LIMITS: Item[] = [
  { label: "AI requests.", text: "While an AI you connected works, our server handles the text it asks for. A changed server could copy it. Disconnecting ends this at once." },
  { label: "The recovery key in the browser.", text: "Approving on ambernotes.app with your recovery key runs our code in your browser. It never stores or sends the key, but a changed page could read it. When you can, approve from your iPhone or Mac instead." },
  { label: "No key rotation yet.", text: "Your notes' key stays the same for the life of your account. Disconnecting an AI deletes its copy of the key, but you can't change the key itself yet." },
  { label: "The database.", text: "Someone running the database can't read your notes, but could roll a note back to an earlier encrypted version, or hide notes from your devices." },
];

/// "Who can see what" on the Privacy & Security page.
export const WHO_CAN_SEE: Item[] = [
  { label: "You,", text: "on every iPhone and Mac you sign in on, once it has your key." },
  { label: "Us.", text: "As the people running the database (that's Emil, who makes Amber Notes), we see the encrypted copies and the details listed under what stays readable. We can't read your notes." },
  { label: "AI apps you approve,", text: "for the notes they ask for, until you disconnect them. They never see the text of locked notes." },
  { label: "Anyone with the link to a note you share,", text: "until you stop sharing it. Your device publishes a readable copy for the link, and it's deleted when you stop. Shared pages are hidden from search engines." },
];

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
