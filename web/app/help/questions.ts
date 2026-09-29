/// The Help page's questions. Short answers, accurate to the app as it ships.
export type QA = { id: string; q: string; a: string[] };

export const FAQ: QA[] = [
  { id: "import", q: "How do I import my Apple Notes?", a: [
    "On your Mac, choose File → Import from Apple Notes. Import everything, or pick the notes you want. Folders, checklists and tables come along, and nothing in Apple Notes is changed.",
    "On iPhone, share a note from Apple Notes to Amber Notes. Or import on your Mac, and everything shows up on your iPhone a second later.",
  ] },
  { id: "connect", q: "How do I connect ChatGPT, Claude, Claude Code or Codex?", a: [
    "In Amber Notes, open Settings → Connect an AI, pick ChatGPT or Claude and follow the steps. You add it once, on a computer. After that, it works in their phone apps too.",
    "Claude Code and Codex get a one-line command with a token of their own.",
  ] },
  { id: "ai-access", q: "Can my AI see all my notes?", a: [
    "Only once you connect it and approve it. You choose read-only, or read and edit. Every change an AI makes keeps the previous version, and you can disconnect any assistant in Settings at any time.",
  ] },
  { id: "free", q: "Is it free?", a: [
    "Yes. Amber Notes is free, with no ads and no tracking. It's also open source, so anyone can read the code.",
  ] },
  { id: "devices", q: "Which devices does it work on?", a: [
    "Mac (macOS 26 or later) and iPhone. The iPhone app is coming to the App Store soon.",
  ] },
  { id: "sync", q: "Does it sync between iPhone and Mac?", a: [
    "Yes. Your notes live in the cloud. Sign in with the same account on your Mac and iPhone, and a change on one shows up on the other in about a second, even while you're typing.",
  ] },
  { id: "storage", q: "Where are my notes stored?", a: [
    "In the cloud, on Supabase's servers in Frankfurt, Germany, in the EU, and on each device you're signed in on. We store your notes so they sync between your devices, and for nothing else. The privacy policy has the details.",
  ] },
  { id: "offline", q: "Does it work offline?", a: [
    "Yes. Your notes are on your device too, so you can read and write without a connection. Your edits stay on the device and sync when you're back online. If the same note changed somewhere else in the meantime, the newer edit wins and the other is kept as a copy, so nothing is lost.",
  ] },
  { id: "share", q: "How do I share a note as a web page, and stop sharing?", a: [
    "Open the note and choose Share → Share Link…, then confirm. The link is copied, and anyone with it can read the note. To stop, choose Share → Stop Sharing, and the page is gone.",
  ] },
  { id: "delete", q: "How do I delete my account?", a: [
    "Open Settings → Account and choose Delete Account…. Your account and all your notes are deleted, and this can't be undone.",
  ] },
  { id: "feedback", q: "How do I report a bug or suggest a feature?", a: [
    "Open an issue on GitHub. Say what happened and what you expected, and a screenshot helps. Ideas are welcome there too.",
  ] },
];
