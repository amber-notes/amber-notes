# Pane

A personal notes app for iPhone and Mac: as simple as Apple Notes, written in markdown,
synced through your own Supabase project, and open to Claude, ChatGPT, Claude Code and
Codex through an MCP server.

## What's in it

- **Apple Notes layout.** Folders, a note list grouped by date (Pinned, Today, Previous 7 Days…),
  and the note. Nested folders, pinning, search, Recently Deleted (30 days).
- **Live markdown.** Headings, bold/italic/strikethrough, code, quotes, links, bulleted, numbered
  and checklist items (tap the circle), tables laid out as a grid. Syntax hides until your caret is on it.
  Return continues lists and quotes; Backspace removes a marker; Tab nests.
- **Cards.** Collapsible sub-notes stored as `<details><summary>Title</summary>…</details>`,
  shown as glass cards you open in place. Edit them in their own sheet.
- **Files.** PDFs, spreadsheets, images, anything: attach, drag in, or paste. Opens in Quick Look.
  A line with just a URL becomes a link preview.
- **Typed tables.** A markdown table with a schema comment above it becomes a tracker:
  latest rows, 7-day averages, and a form with the right control per column. Import an
  `.xlsx` (File → Import Spreadsheet as Table…).
- **Apple Notes import.** Mac: File → Import from Apple Notes… (pick notes; nothing in Apple Notes
  changes). Anywhere: copy a note in Apple Notes and paste; formatting becomes markdown.
- **Sync.** Local-first. Edits push to Supabase with version checks, other devices update live
  over realtime, and a both-sides edit keeps a "conflicted copy" so nothing is lost.
- **AI access (MCP).** 26 tools: overview, search, read (with line ranges and outline), create,
  precise find/replace edits, append under a heading, checklists, folders, history and undo,
  files with download links, and tracker rows. Every change keeps the previous version.

## Security

- Row-level security on every table: a signed-in user sees only their own rows. Sign-ups are off.
- AI tokens are stored as SHA-256 hashes, can be read-only, and are revoked instantly in
  Settings → AI access. The MCP server runs each call as the token's owner with RLS on.
- Files live in a private Storage bucket under your user id; AI clients get 10-minute links.
- The ChatGPT/Claude connector URL contains the token (those clients only take a URL): keep it private,
  and revoke it if it leaks.

## Set it up

1. **Backend (once):** `supabase login`, then `scripts/deploy-backend.sh <your-project-ref>`.
   It applies the schema, deploys the MCP server, turns sign-ups off, creates your account and
   writes `Config/Backend.local.xcconfig` so builds sync with your project.
2. **Mac app:** `xcodegen generate`, open `Pane.xcodeproj`, pick your team under Signing, run the
   `Pane` scheme on "My Mac". (Or build ad-hoc: see `scripts/dogfood-mac.sh`.)
3. **iPhone:** same project, pick your iPhone and your team, run. For TestFlight, archive and upload.
4. **Connect AIs:** in Pane, Settings (gear in the sidebar) → AI access → Create token. The sheet
   shows exactly what to paste for Claude, ChatGPT, Claude Code and Codex.

## Develop

- `supabase start` then `supabase functions serve mcp --no-verify-jwt --env-file supabase/functions/.env.local`
  runs the backend locally (ports 564xx). The app's default config points at it.
- Unit tests: the `PaneTests` target (`xcodebuild test -only-testing:PaneTests`).
- MCP end-to-end: `deno test -A supabase/functions/mcp/e2e.test.ts` with `PANE_MCP_URL` and `PANE_TOKEN`.
- Recorded UI runs: `scripts/dogfood-ios.sh`, `scripts/sync-test.sh`, `scripts/mac-shots.sh`.
