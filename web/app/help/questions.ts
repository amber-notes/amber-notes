import { APP_STORE_LIVE } from "@/lib/site";
/// The Help page's questions. Short answers, accurate to the app as it ships. `more` links the
/// blog post that covers the question in full.
export type QA = { id: string; q: string; a: string[]; more?: { href: string; text: string } };

export const FAQ: QA[] = [
  { id: "what", q: "What is Amber Notes?", a: [
    "Amber Notes is a free, open-source notes app for iPhone and Mac that ChatGPT, Claude, Claude Code, Codex and Incredible can search, read and edit, with your approval. It works like Apple Notes, imports your Apple Notes on the Mac, and syncs between iPhone and Mac.",
  ], more: { href: "/blog/amber-notes-vs-apple-notes", text: "Amber Notes vs Apple Notes" } },
  { id: "import", q: "How do I import my Apple Notes?", a: [
    "On your Mac, choose File → Import from Apple Notes. Import everything, or pick the notes you want. Folders, checklists and tables come along, and nothing in Apple Notes is changed.",
    "On iPhone, share a note from Apple Notes to Amber Notes. Or import on your Mac, and everything shows up on your iPhone a second later.",
  ], more: { href: "/blog/move-from-apple-notes", text: "How to move from Apple Notes, step by step" } },
  { id: "connect", q: "How do I connect ChatGPT, Claude, Claude Code, Codex or Incredible?", a: [
    "In Amber Notes, open Settings → Connect an AI, pick ChatGPT or Claude and follow the steps. You add it once, on a computer. Claude's phone apps can then use it too; for ChatGPT, use chatgpt.com, which is where OpenAI documents custom apps.",
    "Adding it yourself? The address is https://mcp.ambernotes.app. When ChatGPT or Claude asks for permission, sign in on the page that opens, then approve on your iPhone or Mac: type the number the page shows and choose Allow. No device nearby? Use your recovery key on that page.",
    "Claude Code gets a one-line command with a token of its own, and Codex a few lines for its config file. In Incredible, open Apps, search for Amber Notes, choose Connect, then approve it on your iPhone or Mac. On an older version of Incredible, add the address as an MCP server instead. Settings → Connect an AI → Incredible has the steps. Any other app that supports MCP connects with the address and a sign-in too.",
  ], more: { href: "/blog/connect-chatgpt-to-your-notes", text: "How to connect ChatGPT to your notes" } },
  { id: "ai-tools", q: "Can I use Amber Notes in Gemini CLI or VS Code?", a: [
    "Yes. One command adds the address https://mcp.ambernotes.app, then you sign in to Amber Notes in your browser the first time. Claude Code also has a plugin, and Codex takes one command too.",
  ], more: { href: "/blog/mcp-server#install", text: "Install Amber Notes in your AI tool" } },
  { id: "apple-notes-ai", q: "Can ChatGPT or Claude use my notes in Apple Notes?", a: [
    "Only in a limited way, and only on a Mac: Apple Notes has no public API, so AI apps can't reach your notes in iCloud. Amber Notes has an MCP server built in, so once you import your notes, ChatGPT and Claude can use them from any device.",
  ], more: { href: "/blog/claude-and-apple-notes", text: "Can Claude read your Apple Notes?" } },
  { id: "ai-access", q: "Can my AI see all my notes?", a: [
    "Only once you connect it and approve it on your iPhone or Mac. You choose read-only, or read and edit. While it's connected, it can read every note except locked ones: our server opens the notes it asks for in memory, during its requests. Every change an AI makes keeps the previous version, and you can disconnect any assistant in Settings at any time.",
  ], more: { href: "/blog/mcp-server", text: "How the Amber Notes MCP server works" } },
  { id: "free", q: "Is it free?", a: [
    "Yes. Amber Notes is free, with no ads and no tracking in the app. It's also open source, so anyone can read the code.",
  ] },
  { id: "devices", q: "Which devices does it work on?", a: [
    APP_STORE_LIVE ? "Mac (macOS 26 or later) and iPhone." : "Mac (macOS 26 or later) and iPhone. The iPhone app is coming to the App Store soon.",
  ] },
  { id: "sync", q: "Does it sync between iPhone and Mac?", a: [
    "Yes. Your notes live in the cloud. Sign in with the same account on your Mac and iPhone, and a change on one shows up on the other in about a second, even while you're typing.",
  ] },
  { id: "storage", q: "Where are my notes stored?", a: [
    "On each device you're signed in on, and, end-to-end encrypted, on Supabase's servers in Frankfurt, Germany, in the EU. Your notes are encrypted on your iPhone or Mac before they're uploaded, with a key iCloud Keychain carries between your devices, so we can't read them. Some details, such as dates, sizes and folder structure, stay readable. The Privacy & Security page lists all of it.",
  ], more: { href: "/blog/encrypted-notes-app-for-ai", text: "How encryption works with ChatGPT and Claude" } },
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
