import { APP_STORE_LIVE } from "./site";

/// The plain facts about Amber Notes, written once so the home and help pages, /llms.txt and the
/// blog posts say the same thing. Each sentence stands on its own, so it can be quoted without context.

/// Where a new AI app connects: the address the site shows and hands out. The site's Vercel project
/// proxies it to the Supabase function (middleware.ts); connections made at the function's own
/// address keep working.
export const MCP_URL = "https://mcp.pintonotes.com";

/// The address from before the rename. It's the same server and it stays: connectors people already
/// added, the app's Connect an AI screen, the Claude Code plugin, the Gemini CLI extension and the
/// first MCP Registry entry all call it.
export const OLD_MCP_URL = "https://mcp.ambernotes.app";

/// One sentence for the pages that give the address, so nobody thinks an older connection broke.
export const OLD_MCP_URL_STAYS = `The older address, ${OLD_MCP_URL}, is the same server and keeps working, so anything you connected before needs no change.`;

/// Amber Notes' listing in Claude's connector directory (published 2 October 2026). Its Connect to
/// Claude button adds the connector in one step; the custom-connector address is the fallback.
/// claude.ai doesn't hand /directory links to the iPhone app, so on a phone this opens in the browser.
export const CLAUDE_DIRECTORY_URL = "https://claude.ai/directory/amber-notes";

/// One sentence that tells Amber Notes apart from the other apps with a similar name.
export const WHAT_IT_IS =
  "Pinto Notes is a free, open-source notes app for iPhone and Mac that ChatGPT, Claude, Claude Code, Codex and Incredible can search, read and edit, with your approval.";

export const FACTS: string[] = [
  WHAT_IT_IS,
  "It works like Apple Notes: folders, pinned notes, checklists, tables and a note list sorted by date.",
  "On the Mac, it imports your Apple Notes with their folders, and leaves Apple Notes unchanged.",
  "It has a built-in MCP server, so AI apps connect to it directly, without a plugin or a server of your own.",
  "Incredible, the AI assistant from incredible.one, lists Pinto Notes in its Apps: search for it, choose Connect, then sign in and approve it on your iPhone or Mac.",
  `Amber Notes is listed in Claude's connector directory (${CLAUDE_DIRECTORY_URL}): open the listing and choose Connect to Claude.`,
  "You approve each AI app on your iPhone or Mac (or with your recovery key on pintonotes.com), and choose read only, or read and edit. You can disconnect any of them at any time.",
  "When an AI changes a note, Pinto Notes shows what changed, with Undo, and keeps the previous version in the note's history.",
  "Notes sync between iPhone and Mac through the cloud, and are stored as markdown.",
  "Notes are end-to-end encrypted on your iPhone or Mac, with a key iCloud Keychain carries between your devices, so Pinto Notes can't read them at rest. While an AI you approved is working, the server opens the notes it asks for in memory; locked notes stay unreadable to it.",
  APP_STORE_LIVE
    ? "The Mac app (macOS 26 or later) is a free download from pintonotes.com, and the iPhone app is on the App Store."
    : "The Mac app (macOS 26 or later) is a free download from pintonotes.com. The iPhone app is coming soon to the App Store.",
  "The code is on GitHub under the MIT license.",
];
