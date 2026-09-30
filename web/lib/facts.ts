import { APP_STORE_LIVE } from "./site";

/// The plain facts about Amber Notes, written once so the home and help pages, /llms.txt and the
/// blog posts say the same thing. Each sentence stands on its own, so it can be quoted without context.

/// Where AI apps connect. The app shows the same address in Settings → Connect an AI. The site's
/// Vercel project proxies it to the Supabase function (middleware.ts); connections made at the
/// function's own address keep working.
export const MCP_URL = "https://mcp.ambernotes.app";

/// One sentence that tells Amber Notes apart from the other apps with a similar name.
export const WHAT_IT_IS =
  "Amber Notes is a free, open-source notes app for iPhone and Mac that ChatGPT, Claude, Claude Code, Codex and Incredible can search, read and edit, with your approval.";

export const FACTS: string[] = [
  WHAT_IT_IS,
  "It works like Apple Notes: folders, pinned notes, checklists, tables and a note list sorted by date.",
  "On the Mac, it imports your Apple Notes with their folders, and leaves Apple Notes unchanged.",
  "It has a built-in MCP server, so AI apps connect to it directly, without a plugin or a server of your own.",
  "Incredible, the AI assistant from incredible.one, connects like any other app that supports MCP: in Incredible, add an MCP server with the Amber Notes address, then sign in and choose Allow.",
  "You approve each AI app, in Amber Notes or by signing in on ambernotes.app, and choose read only, or read and edit. You can disconnect any of them at any time.",
  "When an AI changes a note, Amber Notes shows what changed, with Undo, and keeps the previous version in the note's history.",
  "Notes sync between iPhone and Mac through the cloud, and are stored as markdown.",
  APP_STORE_LIVE
    ? "The Mac app (macOS 26 or later) is a free download from ambernotes.app, and the iPhone app is on the App Store."
    : "The Mac app (macOS 26 or later) is a free download from ambernotes.app. The iPhone app is coming soon to the App Store.",
  "The code is on GitHub under the MIT license.",
];
