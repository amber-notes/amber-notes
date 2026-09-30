# Directory submissions: Claude and ChatGPT

Everything needed to list Amber Notes in Claude's connector directory and ChatGPT's plugin directory (OpenAI's name for what used to be the app directory). Requirements were checked against Anthropic's and OpenAI's own docs on 2026-09-30. Each one has a source link.

Nothing here has been submitted.

## 1. Blockers, in order

1. **Sign-in has to work in a browser without the app.** Today `/authorize` sends the browser to `ambernotes://connect` (`supabase/functions/mcp/oauth.ts:279`). A reviewer at claude.ai or chatgpt.com who doesn't have the Mac or iPhone app signed in gets stuck at that step. The mcp-web branch (`feature/mcp-web`) replaces it with `ambernotes.app/connect`, which has email-and-password sign-in. That page has to be live before either submission.
2. **The server address has to be final: `https://mcp.ambernotes.app`.**
   - OpenAI: "Changing the MCP origin (scheme, host or port) needs a new plugin" ([submission](https://developers.openai.com/plugins/deploy/submission)).
   - Anthropic: "The MCP server domain should match your service" ([review criteria](https://claude.com/docs/connectors/building/review-criteria)).
   - Both listings use the root address exactly, with no `/mcp` on the end. Anthropic says the `resource` in the metadata "must equal the URL as the user enters it in Claude, including any path component" ([authentication](https://claude.com/docs/connectors/building/authentication)).
   - The mcp-web branch is building the alias. `web/lib/facts.ts:7` (`MCP_URL`) still names the supabase.co address, and so do the blog and the app.
3. **The demo account needs cleaning and more content** (section 7).
   - Both directories want "a fully populated account".
   - Right now it has five notes. One of them is a stray empty table titled "— —", and two notes end in a stray empty table.
4. **OpenAI identity verification.** Emil has to finish individual verification in the OpenAI Platform before submitting under his name ([app review](https://developers.openai.com/plugins/deploy/app-review)).
5. **The demo video**, which OpenAI requires for MCP review (section 6).
6. **Merge and deploy this branch.** It carries the annotation fixes and the domain-verification endpoint. OpenAI's automated scan reads the annotations, and Anthropic's portal flags tools that are missing them.

## 2. Requirement checklists

Status meanings:
- **done**: true on this branch or already true in production.
- **mcp-web**: the web sign-in and domain work on `feature/mcp-web` covers it.
- **Emil**: needs Emil's accounts, identity or screen.

### Claude (Anthropic connectors directory)

| Requirement | Source | Status |
|---|---|---|
| Submit at claude.ai/directory/manage → Submit new → MCP connector. The submitter needs a Pro, Max, Team or Enterprise plan. | [submission](https://claude.com/docs/connectors/building/submission), [publish](https://claude.com/docs/directory/publish) | Emil |
| Remote server over Streamable HTTP | [build](https://claude.com/docs/connectors/building/index) | done (`index.ts`, JSON responses) |
| Every tool has a `title`, plus `readOnlyHint: true` if it only reads and `destructiveHint: true` if it modifies or deletes data | [review criteria](https://claude.com/docs/connectors/building/review-criteria), [policy 5.E](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) | done (this branch: explicit hints on every tool, and edit_note, restore_revision and log_table_row are now destructive) |
| Tool names are 64 characters or fewer | [policy 5.C](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) | done (checked in `annotations.test.ts`) |
| Descriptions say what the tool does, not how Claude should behave | [review criteria](https://claude.com/docs/connectors/building/review-criteria) | mcp-web: `tools.ts:37` says "Start here.", and mcp-web's draft says "Call this first." mcp-web was asked to drop both. |
| Reads and writes are separate tools, with no catch-all request tool | [review criteria](https://claude.com/docs/connectors/building/review-criteria) | done |
| Errors are actionable, not a bare "Bad Request" | [review criteria](https://claude.com/docs/connectors/building/review-criteria) | done (every ToolError names the fix, e.g. "No note titled … Close matches: …") |
| Responses are "frugal with tokens". Results can be up to about 150k characters on claude.ai and 25k tokens in Claude Code. | [policy 5.B](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy), [build](https://claude.com/docs/connectors/building/index) | done (this branch: read_note and fetch cap at 60k characters and return `truncated` with `next_start_line`) |
| OAuth. DCR or CIMD is supported by default, and CIMD is used only when advertised. The token endpoint needs S256 PKCE and must accept form-encoded bodies. | [authentication](https://claude.com/docs/connectors/building/authentication) | done (DCR, PKCE S256, form or JSON on `/token`) |
| Redirect URI `https://claude.ai/api/mcp/auth_callback` accepted. For Claude Code, loopback on any port. | [authentication](https://claude.com/docs/connectors/building/authentication) | done (`validRedirect` accepts any https, and `redirectMatches` ignores the loopback port) |
| An unauthenticated request gets a 401 with `WWW-Authenticate`, and Claude uses only the first `authorization_servers` entry | [authentication](https://claude.com/docs/connectors/building/authentication) | done (`index.ts` `unauthorized`, `oauth.ts:155`) |
| Refresh tokens rotate, and a dead one returns `invalid_grant` | [authentication](https://claude.com/docs/connectors/building/authentication) | done |
| Reachable from `160.79.104.0/21` over IPv4 | [IP addresses](https://platform.claude.com/docs/en/api/ip-addresses), [troubleshooting](https://claude.com/docs/connectors/building/troubleshooting) | mcp-web (Vercel and Supabase both have A records; check once the alias is live) |
| Consent works in a browser | implied by the reviewer test | mcp-web |
| Test account "with sample data", "fully populated", with step-by-step access | [policy 3.D](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy), [testing](https://claude.com/docs/connectors/building/testing) | Emil (section 7) |
| At least three working example prompts | [policy 3.E](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) | done (section 4.3) |
| Public documentation by the publish date | [review criteria](https://claude.com/docs/connectors/building/review-criteria) | done: [/blog/connect-chatgpt-to-your-notes](https://ambernotes.app/blog/connect-chatgpt-to-your-notes) has a Claude section, and [/blog/mcp-server](https://ambernotes.app/blog/mcp-server) lists every tool. Its steps say "Allow in Amber Notes", so they need updating once web consent ships (mcp-web). |
| Privacy policy covering collection, use, storage, sharing and retention | [policy 3.A](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy), [submission](https://claude.com/docs/connectors/building/submission) | done ([/privacy](https://ambernotes.app/privacy) has an "AI connections" section). The line "You approve the connection inside Amber Notes" (`docs/privacy-policy.md:81`) needs updating when web approval ships (mcp-web). |
| Owns the domain it connects to | [policy 3.F](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) | done (ambernotes.app) |
| A way to receive security reports | [directory terms](https://support.claude.com/en/articles/13145338-anthropic-software-directory-terms) | done (`SECURITY.md` in the repo) |
| Seven policy acknowledgments, typed in the portal | [submission](https://claude.com/docs/connectors/building/submission) | Emil |
| Every tool run by hand in MCP Inspector or as a custom connector before submitting | [review criteria](https://claude.com/docs/connectors/building/review-criteria) | Emil (a 10-minute run on the demo account) |

- **Review time:** "isn't fixed" ([publish](https://claude.com/docs/directory/publish)). New submissions are scanned automatically and listed as Community. Anthropic may escalate them to Verified, where a person tests every tool.
- **Icon:** no size or format spec is published for remote connectors. Upload the 512 px PNG.

### ChatGPT (OpenAI plugin directory)

| Requirement | Source | Status |
|---|---|---|
| Submit a ZIP at platform.openai.com → Plugins → Upload. The submitter is an org owner or has Apps Management write. | [submission](https://developers.openai.com/plugins/deploy/submission) | Emil (the ZIP is `brand/directory/chatgpt-plugin/`) |
| Verified individual or business identity, matching `developerName` | [app review](https://developers.openai.com/plugins/deploy/app-review), [guidelines](https://developers.openai.com/plugins/plugin-guidelines) | Emil (individual: "Emil Wagman", as in the privacy policy) |
| A project with global data residency, not EU | [app review](https://developers.openai.com/plugins/deploy/app-review) | Emil |
| Domain verification: the bare token at `https://<MCP host>/.well-known/openai-apps-challenge` | [submission](https://developers.openai.com/plugins/deploy/submission) | done in code (this branch, `verification.ts`, from the `OPENAI_APPS_CHALLENGE` secret). Emil sets the secret. It needs the mcp-web alias to forward `/.well-known/*`. |
| Streamable HTTP on public HTTPS. No UI is required. | [MCP server](https://developers.openai.com/plugins/build/mcp-server) | done |
| `readOnlyHint`, `destructiveHint` and `openWorldHint` are explicit booleans on every tool, and they match what the tool does. Undo doesn't justify `destructiveHint: false`. | [guidelines](https://developers.openai.com/plugins/plugin-guidelines), [reference](https://developers.openai.com/plugins/reference) | done (this branch. Before it, read tools had no `destructiveHint`.) |
| Per-tool `securitySchemes` | [auth](https://developers.openai.com/plugins/build/auth) | done (this branch: oauth2 with `notes:read` or `notes:write`) |
| OAuth 2.1 with PKCE S256. DCR is supported (CIMD preferred). Protected resource metadata. A 401 with `resource_metadata`. | [auth](https://developers.openai.com/plugins/build/auth) | done |
| Redirect `https://chatgpt.com/connector_platform_oauth_redirect`, used when the server supports RFC 9207 `iss` | [auth](https://developers.openai.com/plugins/build/auth) | done (`iss` advertised and sent). mcp-web: `iss` must equal the alias issuer on every redirect, including errors and deny. |
| Test account with no MFA, email codes or magic links, and "fully featured" | [submission](https://developers.openai.com/plugins/deploy/submission), [guidelines](https://developers.openai.com/plugins/plugin-guidelines) | mcp-web (password sign-in on /connect) and Emil (data, section 7) |
| Exactly 5 positive and 3 negative test cases | [submission](https://developers.openai.com/plugins/deploy/submission) | done (in `plugin.json`) |
| Demo recording URL | [submission](https://developers.openai.com/plugins/deploy/submission), [errors](https://developers.openai.com/plugins/deploy/submission-errors) | Emil (section 6) |
| Website, support, privacy and terms URLs | [submission](https://developers.openai.com/plugins/deploy/submission) | done |
| Square icon, at least 48 px | [submission](https://developers.openai.com/plugins/deploy/submission) | done (`assets/logo.png` is 512, `assets/icon.png` is 128) |
| No screenshots without UI | [errors](https://developers.openai.com/plugins/deploy/submission-errors) | done (none included) |
| Name of 30 characters or fewer, not generic, no "MCP" or "Plugin" suffix | [guidelines](https://developers.openai.com/plugins/plugin-guidelines) | done ("Amber Notes") |
| No pricing, "free" or comparisons in the listing | [guidelines](https://developers.openai.com/plugins/plugin-guidelines) | done. The listing copy avoids "free" and Apple Notes on purpose. |
| No diagnostic, telemetry or request ids in responses | [guidelines](https://developers.openai.com/plugins/plugin-guidelines) | done. Note ids, versions and revision ids are needed to act on notes. |
| Suitable for ages 13 and up, no ads, no commerce | [guidelines](https://developers.openai.com/plugins/plugin-guidelines) | done |
| Works on desktop and mobile ChatGPT | [guidelines](https://developers.openai.com/plugins/plugin-guidelines) | Emil (try it once on the iPhone) |

- **Review time:** "may vary… Please do not contact support to request expedited review" ([app review](https://developers.openai.com/plugins/deploy/app-review)).
- **After approval:** OpenAI rescans the server daily, and Emil chooses when to publish.

## 3. Server audit

The server is `supabase/functions/mcp/`. Line numbers are for this branch.

**Fixed on this branch**

| Gap | Where | Fix |
|---|---|---|
| Read tools had no `destructiveHint`, which OpenAI requires explicitly | `tools.ts:30` | `read` now states `destructiveHint: false, idempotentHint: true` |
| edit_note, restore_revision and log_table_row were marked non-destructive, although all three overwrite existing text or a table row | `tools.ts:87`, `:164`, `:202` | `overwrite` annotations (`destructiveHint: true`) |
| No per-tool `securitySchemes` | `tools.ts:18`, `:223` | oauth2 with `notes:read` for readers and `notes:write` for writers |
| read_note and fetch returned the whole note, up to 5 MB | `tools.ts:456`, `:723` | Capped at 60k characters on whole lines, returning `truncated`, `lines` and `next_start_line` (`fitLines` in `notes.ts`) |
| Nothing served OpenAI's domain challenge | `index.ts:63`, `verification.ts` | `/.well-known/openai-apps-challenge` answers with the `OPENAI_APPS_CHALLENGE` secret as plain text, or 404 when it isn't set |

Tests, none of which need Docker:
- `annotations.test.ts`: titles, all three hints, the destructive set, name rules and scopes.
- `verification.test.ts`
- `notes.test.ts`: the new `fitLines` case.

CI now runs all three.

**Open, owned elsewhere**

| Gap | Where | Owner |
|---|---|---|
| Consent goes only to the app | `oauth.ts:279` | mcp-web |
| "Start here." tells the model how to behave | `tools.ts:37` | mcp-web (asked to use "An overview of the person's Amber Notes: …" with no "Call this first") |
| The MCP address is on supabase.co | `web/lib/facts.ts:7`, app Settings | mcp-web |
| The privacy policy says approval happens only in the app | `docs/privacy-policy.md:81` | mcp-web, once web consent ships |

**Open, for Emil to decide**

| Gap | Where | Why it matters |
|---|---|---|
| `search` and `fetch` return `url: pane://note/<id>`, a scheme nothing handles (the app registers only `ambernotes://`, `project.yml:67`) | `tools.ts:717`, `:725` | ChatGPT shows this as the source link, and a reviewer who clicks it gets nothing. There are two fixes: handle `ambernotes://note/<id>` in the app and return that, or drop `url`. I'd make the app handle `ambernotes://note/<id>`, since opening the note from a ChatGPT answer is useful on its own. |
| The file header still says "Pane's MCP server" | `index.ts:1` | Cosmetic, and reviewers don't see it. |

**Checked and fine**
- **CORS:** `*`, with `www-authenticate` and `mcp-session-id` exposed. No directory requires more.
- **Errors:** tool errors come back as `isError` results that name the fix. Protocol errors use proper JSON-RPC codes.
- **Other size limits:** lists are capped (list_notes 200, search_notes 50, history 50).
- **Rate limits:** 600 calls, then 5 a second, per account. That is plenty for a reviewer.
- **Read-only grants** hide the write tools from `tools/list`. Reviewers must choose **Read and edit** when connecting, or the write test cases have nothing to call.
- **Other tool rules:** no tool calls anything outside Amber Notes (`openWorldHint: false` is accurate), and no tool asks for conversation history.

**Annotation justifications**

OpenAI's error reference still lists `justification_required`, though its guidelines say justifications are no longer needed. If the portal asks, paste these:

| Tool | read / destructive / open world | Justification |
|---|---|---|
| get_overview, search_notes, list_notes, read_note, list_folders, note_history, list_files, read_table, search, fetch | true / false / false | Reads the signed-in person's own notes. Changes nothing and reaches nothing outside Amber Notes. |
| get_file | true / false / false | Returns file details and a 10-minute download link to the person's own file in Amber Notes storage. Changes nothing. |
| create_note, create_sub_note, create_folder | false / false / false | Only adds a new note or folder. Nothing existing is changed. |
| append_to_note | false / false / false | Only adds text to a note. Existing text stays as it is. |
| set_checklist_item, pin_note, move_note, rename_folder, restore_note | false / false / false | Changes a checkbox, the pin, the folder, a folder's name, or brings a note back. No note text is removed. |
| edit_note, replace_note_body, restore_revision, log_table_row | false / true / false | Overwrites existing note text or a table row. The earlier version stays in the note's history. |
| delete_note, delete_folder, delete_table_row | false / true / false | Removes notes, folders or a table row. Notes go to Recently Deleted for 30 days. |

## 4. Claude packet

Paste these into claude.ai/directory/manage → Submit new → MCP connector.

### 4.1 Connection
- **URL:** `https://mcp.ambernotes.app` (single URL).
- **Tools:** 27, synced automatically. The portal should flag none of them.

### 4.2 Listing
- **Server name:** Amber Notes
- **One-liner (≤200):** Search, read and edit your notes in Amber Notes, the notes app for iPhone and Mac, with every change kept in the note's history.
- **Description (≤2,000):**

  > Amber Notes is a notes app for iPhone and Mac. Connect it to Claude and your notes become something Claude can work with: ask what's on your lists, pull a fact out of a note, or have Claude write things down for you.
  >
  > Claude can search your notes, read them (long notes in parts), create notes and sub-notes, add to the end of a note or under a heading, make exact edits, tick checklist items, read tables and log rows in trackers, move, pin and delete notes, and restore earlier versions.
  >
  > When you connect, you sign in to Amber Notes and choose Read only or Read and edit. Read only hides every tool that changes anything. You can disconnect at any time in Settings → Connect an AI in Amber Notes.
  >
  > Every change Claude makes keeps the previous version in the note's history, and Amber Notes shows what changed, with Undo. Deleted notes stay in Recently Deleted for 30 days.

- **Categories:** Productivity. Add a second one if the portal has "Notes" or "Knowledge". The category list is only visible in the portal.
- **Documentation URL:** https://ambernotes.app/blog/connect-chatgpt-to-your-notes (it has a Claude section). https://ambernotes.app/blog/mcp-server lists the tools.
- **Privacy policy URL:** https://ambernotes.app/privacy
- **Support contact:** emil@norditech.se (the address on /support and in the privacy policy), https://ambernotes.app/support
- **Icon:** `brand/directory/icon-512.png`, or `icon-1024.png` if the portal asks for larger.
- **Slug (permanent):** `amber-notes`

### 4.3 Use cases
- **Primary use cases:**
  1. Find and summarize notes.
  2. Answer questions from notes.
  3. Keep lists and trackers up to date from a conversation.
  4. Write new notes from what you discuss.
- **What users need first:** an Amber Notes account, made in the iPhone or Mac app or on ambernotes.app.
- **Reads or writes:** both.

Example prompts (policy 3.E asks for at least three). The expected results are for the demo account after section 7.

| # | Prompt | Expected tools | Expected result |
|---|---|---|---|
| 1 | "Find my Lisbon trip note and summarize the plan." | search_notes, read_note | Summary of "Lisbon in May" (Travel): the checklist, what's done and what's open, and the three places to eat. Nothing changes. |
| 2 | "What's the confirmation number for my Lisbon hotel?" | search_notes, read_note | "LX-48213, Memmo Príncipe Real, 12–15 May", read from the sub-note "Hotel booking". |
| 3 | "Check off 'Tram 28 early' in my Lisbon note." | set_checklist_item | The item is ticked and Claude confirms. The note's history has the previous version. |
| 4 | "Log today's run in my Running log: 5.2 km, 28 minutes, felt 4 out of 5." | read_table, log_table_row | A row for today in the tracker. A second run the same day updates that row instead of adding one. |
| 5 | "Turn my design meeting points into a checklist in a new note called Design follow-ups in Work." | read_note, create_note | A new note in Work with three unchecked items. |
| 6 | "Add 'Pack an adapter' to my Lisbon checklist." | append_to_note or edit_note | The item is added under Plan. Claude asks before any destructive edit. |
| 7 | "What did I change in my Lisbon note recently? Undo the last change." | note_history, restore_revision | Lists the versions, then restores the previous one after Claude asks. |

### 4.4 Company
- **Company:** Emil Wagman (individual developer, Sweden). Use Norditech AB only if Emil wants the listing under the company, and then change the privacy policy's controller line to match.
- **Website:** https://ambernotes.app
- **Primary contact:** emil@norditech.se

### 4.5 Authentication
- **Type:** OAuth with dynamic client registration (`oauth_dcr`). The server doesn't advertise CIMD, so Claude uses DCR ([authentication](https://claude.com/docs/connectors/building/authentication)).
- **Callback:** `https://claude.ai/api/mcp/auth_callback`. It is already accepted, because any https redirect can register.

### 4.6 Data handling
- **API ownership:** own first-party API. The server is part of Amber Notes, and the data is the person's own notes.
- **Personal health data:** no. Notes are free text a person writes, but the service doesn't collect health data as such.
- **Sponsored content:** no.

### 4.7 Test and launch (reviewer instructions)

Paste this, and have Emil type the password into the form himself:

> 1. In Claude, open Settings → Connectors → Add custom connector, or use the directory listing, and connect `https://mcp.ambernotes.app`.
> 2. A browser page from ambernotes.app opens. Sign in with email and password (use the App Review demo account below). There is no two-factor step.
> 3. Choose **Read and edit**, then **Allow**. You're sent back to Claude.
> 4. Try the prompts above. The account has folders Personal, Work and Travel. "Lisbon in May" (Travel) has a checklist, a table and a sub-note. "Running log" (Personal) is a tracker.
> 5. Every change is reversible: note_history and restore_revision undo edits, and restore_note brings back a deleted note.
>
> Email: appreview@norditech.se
> Password: (typed by Emil)

Tick "I ran every tool" only after doing it (section 8, step 6).

### 4.8 Compliance
All seven acknowledgments apply without exceptions:
- no financial transactions;
- no AI media generation;
- no prompt injection in descriptions (once mcp-web's wording lands);
- no conversation data collected;
- public docs exist.

## 5. ChatGPT packet

The ZIP source is `brand/directory/chatgpt-plugin/`: `plugin.json`, `mcp.json`, and `assets/` holding the logo and composer icon. Build the upload with:

```sh
cd brand/directory/chatgpt-plugin && zip -r ../amber-notes-chatgpt.zip . -x '.*'
```

What the ZIP already holds:
- display name, subtitle, long description, category, capabilities, the four URLs, and three starter prompts;
- brand colors (#E39410 and #F5AD33 from the site's accent tokens) and the icons;
- the 5 positive and 3 negative test cases;
- `commerce: false`, and `countries: []` (everywhere).

It leaves out:
- **the demo recording URL**, which is added in the dashboard after recording;
- **credentials**, which OpenAI rejects inside the ZIP. They go in the dashboard under Review details.

**Dashboard fields (not in the ZIP)**
- **Developer identity:** Emil Wagman (individual verification).
- **MCP server URL:** `https://mcp.ambernotes.app`
- **Domain verification:**
  1. Copy the token from the portal.
  2. `supabase secrets set OPENAI_APPS_CHALLENGE=<token> --project-ref rodegaeruhyybqilrnpn`
  3. Check with `curl https://mcp.ambernotes.app/.well-known/openai-apps-challenge`, which should print only the token.
  4. Click Verify.
- **OAuth:** ChatGPT registers itself through DCR. If the page shows a redirect URI, it will be `https://chatgpt.com/connector_platform_oauth_redirect`, which is already accepted.
- **Review details, test account:** use the same instructions as section 4.7, with ChatGPT's Plugins settings in place of the Claude path (OpenAI renamed Apps to Plugins in 2026). The login URL is `https://ambernotes.app/connect`. The account needs no MFA, email code or magic link.
- **Demo recording URL:** an unlisted YouTube link or a public file link (section 6).
- **Policy attestations:** Emil ticks these.

**Test cases** are in `plugin.json`, 5 positive and 3 negative:
- Positive: summarize Lisbon; hotel confirmation; tick Tram 28; add A Cevicheria to the table; Design follow-ups from the design meeting.
- Negative: the weather, booking a flight, reading Apple Notes. For each one, the expected result is no Amber Notes call, or a clear "can't" with no change.
- Run all eight in ChatGPT with the demo account before submitting, as OpenAI asks.

## 6. Demo video (75 seconds)

OpenAI requires one, and it must show "the main use cases and tools across supported platforms". Use the same cut for Claude, where it's optional.

| Shot | Time | What's on screen | Where to record |
|---|---|---|---|
| 1 | 0–6 s | Amber Notes on the Mac with the Lisbon note open. Caption: "Amber Notes: your notes, in ChatGPT." | Emil's Mac (screen recording of the app) |
| 2 | 6–20 s | ChatGPT on the web: Apps, connect Amber Notes, the ambernotes.app sign-in page, **Read and edit**, **Allow**, and back to ChatGPT. | Emil's Mac, Chrome with a clean profile signed in to the demo ChatGPT account |
| 3 | 20–32 s | Prompt: "Find my Lisbon trip note and summarize the plan." Show the tool call and the answer. | Emil's Mac, ChatGPT web |
| 4 | 32–42 s | Prompt: "What's the confirmation number for my Lisbon hotel?" Answer: LX-48213. | Emil's Mac, ChatGPT web |
| 5 | 42–55 s | Prompt: "Check off 'Tram 28 early' and add A Cevicheria to the Where to eat table." Then switch to Amber Notes: the tick and the new row appear, with the change banner and Undo. | ChatGPT on the Mac. The Amber Notes half can be the iOS Simulator (Xcode, iPhone 17) signed in to the demo account. |
| 6 | 55–65 s | ChatGPT on iPhone: "What's still open on my Lisbon checklist?" | A real iPhone screen recording. The ChatGPT app can't run in the Simulator. |
| 7 | 65–75 s | Amber Notes → Settings → Connect an AI, showing the connection, then Disconnect. Caption: "You choose read only or read and edit, and you can disconnect at any time." | iOS Simulator or the Mac app |

Notes:
- Record ChatGPT with a ChatGPT account whose history is clean. The demo notes account is separate from it.
- No personal notes may be visible: sign the Mac app in to the demo account, or use the Simulator for every Amber Notes shot.
- No voice-over is required. Captions are enough.
- Only Emil can record shots 2 to 6, because they need his ChatGPT login and his phone. Shots 1, 5 (the Amber Notes half) and 7 can be done in the iOS Simulator by an agent without touching his Mac's input, using `simctl io recordVideo`.

## 7. Demo account

**What's there (checked 2026-09-30, read only)**
- Folders: Personal, Work and Travel.
- Five notes:
  - "Lisbon in May": a checklist, a table, and the sub-note "Hotel booking";
  - "Hotel booking";
  - "Meeting with design";
  - "Book notes: The Creative Act";
  - a stray note that is only an empty table, titled "— —".
- "Lisbon in May" and "Book notes" also end in a stray empty two-column table. That may be an app bug worth a look: an empty table left behind by the editor.
- No files and no trackers.

**What to do (Emil, in the app)**

1. Delete the "— —" note, and remove the stray empty tables at the end of "Lisbon in May" and "Book notes".
2. Add these notes. Paste each body into a new note in the named folder.
   - Personal, "Running log", a tracker. Make it in the app as a table with typed columns Date (date), Distance km (number), Minutes (number), Feel (scale 1–5), and add three rows from last week.
   - Personal, "Groceries":
     ```
     Groceries
     - [ ] Oat milk
     - [ ] Eggs
     - [x] Coffee beans
     - [ ] Tomatoes
     ```
   - Work, "Q4 planning":
     ```
     Q4 planning
     ## Goals
     - Ship the iPhone app
     - 1,000 weekly users
     ## Risks
     - App Review delays
     - Sync edge cases on slow networks
     ## Decisions
     - Weekly release on Thursdays
     ```
   - Work, "Hiring: designer", with a few interview notes in a table (Name, Date, Verdict).
   - Travel, "Packing list", a checklist of 8 to 10 items.
   - Attach one small PDF, for example a sample itinerary, to "Lisbon in May", so list_files and get_file have something to return.
   - Pin "Groceries".
3. Keep it this way. Reviewers will make changes, and OpenAI keeps using the account for later reviews, so check it before each resubmission.
4. The same account is in Apple's review right now (iOS 1.0). Edits by directory reviewers can show up there. To keep them apart, make a second account (for example directory-review@norditech.se) with the same content and give that one to Anthropic and OpenAI. The instructions above then use that email.

## 8. What only Emil can do

1. **Claude:**
   - Sign in at claude.ai with a Pro, Max or Team plan.
   - Open claude.ai/directory/manage and accept the Software Directory Terms.
   - Fill in section 4, typing the demo password into the Test and launch step yourself.
   - Tick the seven acknowledgments.
2. **OpenAI:**
   - Sign in at platform.openai.com.
   - Use (or create) an org whose project has global data residency.
   - Finish individual identity verification (government ID).
   - Accept the plugin terms.
3. **OpenAI domain verification:** copy the token, then run the `supabase secrets set` command in section 5. The function reads it at request time, so no redeploy is needed.
4. **Demo account:** do the cleanup and additions in section 7, in the app. Optionally create the separate review account.
5. **Record the demo video** (section 6, shots 2 to 6) and upload it unlisted.
6. **Run everything before submitting:** connect Claude and ChatGPT to `https://mcp.ambernotes.app` with the demo account, and run every prompt in sections 4.3 and 5 once. Both portals ask you to confirm this.
7. **Upload the ZIP** at platform.openai.com → Plugins. Fill in Review details with the test account instructions and type the password yourself. Paste the video link, then submit.
8. **Decide on `pane://` links** (section 3).

## 9. Assets

All made from `brand/` sources with `sips`:

| File | Size | Use |
|---|---|---|
| `brand/directory/icon-1024.png` | 1024², RGB | Claude icon if larger is wanted (from `brand/icon-ios-1024.png`) |
| `brand/directory/icon-512.png` | 512², RGB | Claude icon. Also ChatGPT `logo` and `logoDark`. |
| `brand/directory/mark-512.png` | 512², transparent | Spare. The mark without its background. |
| `brand/directory/mark-128.png` | 128², transparent | ChatGPT `composerIcon` and `composerIconDark` |

Screenshots are not needed. Claude asks for them only for MCP Apps with UI, and OpenAI rejects them without UI.
