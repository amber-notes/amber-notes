# Directory submissions: Claude and ChatGPT

Everything needed to list Amber Notes in Claude's connector directory and ChatGPT's plugin directory (OpenAI's name for what used to be the app directory). Requirements were checked against Anthropic's and OpenAI's own docs on 2026-09-30. Each one has a source link.

Nothing here has been submitted.

## 1. Status and what's left

State on 2026-09-30:
- **Server:** live at `https://mcp.ambernotes.app` with web approval at ambernotes.app/connect (PR 20).
- **Demo account:** cleaned and filled (section 7).
- **Live check:** every test prompt's tool calls were run against production as the demo user, through the same sign-in a directory client uses (section 7.3).

Left before submitting, in order:
1. **Deploy the branch `prep/directories-2`**, which does four things:
   - When a multi-word search finds nothing, it retries with any of the words. Today `search` for "Lisbon trip" returns nothing, because every word must match, and "trip" isn't in the note.
   - It drops the dead `pane://` links from `search` and `fetch`.
   - It restores the site's tool list, which PR 18 merged without.
   - It adds `server.json` and `glama.json`.
2. **Emil: OpenAI individual identity verification** ([app review](https://developers.openai.com/plugins/deploy/app-review)).
3. **Emil: the demo video**, required for OpenAI's MCP review (section 6).
4. **Emil: run the prompts once in Claude and ChatGPT.** Both portals ask the submitter to confirm this.
5. **Emil: submit** (section 8).

Both listings use the root address, exactly `https://mcp.ambernotes.app`, with no `/mcp` on the end:
- OpenAI: "Changing the MCP origin … needs a new plugin" ([submission](https://developers.openai.com/plugins/deploy/submission)).
- Anthropic: `resource` "must equal the URL as the user enters it" ([authentication](https://claude.com/docs/connectors/building/authentication)).

## 2. Requirement checklists

Status meanings:
- **done**: true on this branch or already true in production.
- **mcp-web**: done in PR 20 (web sign-in, mcp.ambernotes.app), live since 2026-09-30.
- **Emil**: needs Emil's accounts, identity or screen.

### Claude (Anthropic connectors directory)

| Requirement | Source | Status |
|---|---|---|
| Submit at claude.ai/directory/manage → Submit new → MCP connector. The submitter needs a Pro, Max, Team or Enterprise plan. | [submission](https://claude.com/docs/connectors/building/submission), [publish](https://claude.com/docs/directory/publish) | Emil |
| Remote server over Streamable HTTP | [build](https://claude.com/docs/connectors/building/index) | done (`index.ts`, JSON responses) |
| Every tool has a `title`, plus `readOnlyHint: true` if it only reads and `destructiveHint: true` if it modifies or deletes data | [review criteria](https://claude.com/docs/connectors/building/review-criteria), [policy 5.E](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) | done (this branch: explicit hints on every tool, and edit_note, restore_revision and log_table_row are now destructive) |
| Tool names are 64 characters or fewer | [policy 5.C](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) | done (checked in `annotations.test.ts`) |
| Descriptions say what the tool does, not how Claude should behave | [review criteria](https://claude.com/docs/connectors/building/review-criteria) | done (PR 20: "An overview of the person's Amber Notes: …") |
| Reads and writes are separate tools, with no catch-all request tool | [review criteria](https://claude.com/docs/connectors/building/review-criteria) | done |
| Errors are actionable, not a bare "Bad Request" | [review criteria](https://claude.com/docs/connectors/building/review-criteria) | done (every ToolError names the fix, e.g. "No note titled … Close matches: …") |
| Responses are "frugal with tokens". Results can be up to about 150k characters on claude.ai and 25k tokens in Claude Code. | [policy 5.B](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy), [build](https://claude.com/docs/connectors/building/index) | done (this branch: read_note and fetch cap at 60k characters and return `truncated` with `next_start_line`) |
| OAuth. DCR or CIMD is supported by default, and CIMD is used only when advertised. The token endpoint needs S256 PKCE and must accept form-encoded bodies. | [authentication](https://claude.com/docs/connectors/building/authentication) | done (DCR, PKCE S256, form or JSON on `/token`) |
| Redirect URI `https://claude.ai/api/mcp/auth_callback` accepted. For Claude Code, loopback on any port. | [authentication](https://claude.com/docs/connectors/building/authentication) | done (`validRedirect` accepts any https, and `redirectMatches` ignores the loopback port) |
| An unauthenticated request gets a 401 with `WWW-Authenticate`, and Claude uses only the first `authorization_servers` entry | [authentication](https://claude.com/docs/connectors/building/authentication) | done (`index.ts` `unauthorized`, `oauth.ts:155`) |
| Refresh tokens rotate, and a dead one returns `invalid_grant` | [authentication](https://claude.com/docs/connectors/building/authentication) | done |
| Reachable from `160.79.104.0/21` over IPv4 | [IP addresses](https://platform.claude.com/docs/en/api/ip-addresses), [troubleshooting](https://claude.com/docs/connectors/building/troubleshooting) | mcp-web (Vercel and Supabase both have A records; check once the alias is live) |
| Consent works in a browser | implied by the reviewer test | done (PR 20, ambernotes.app/connect, with email-and-password or Apple sign-in; checked live) |
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
| Domain verification: the bare token at `https://<MCP host>/.well-known/openai-apps-challenge` | [submission](https://developers.openai.com/plugins/deploy/submission) | done: the site serves the token itself (`web/app/.well-known/openai-apps-challenge/route.ts`), on mcp.ambernotes.app as well. |
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
| Nothing served OpenAI's domain challenge | `web/app/.well-known/openai-apps-challenge/route.ts` | The site serves the token as plain text on both hosts; middleware lets the path through on mcp.ambernotes.app. (It was first the function's `OPENAI_APPS_CHALLENGE` secret, which was never set.) |

Tests, none of which need Docker:
- `annotations.test.ts`: titles, all three hints, the destructive set, name rules and scopes.
- `web/app/.well-known/openai-apps-challenge/route.test.ts`
- `notes.test.ts`: the new `fitLines` case.

CI now runs all three.

**Open, owned elsewhere**

| Gap | Where | Owner |
|---|---|---|
| The privacy policy and terms say approval happens only in the app | `docs/privacy-policy.md:10`, `:81`, `docs/terms-of-use.md:54` | PR 27 (wording only), waiting to merge |
| llms.txt and the guides say "then Allow in Amber Notes" | `web/lib/facts.ts`, `web/app/blog/connect-chatgpt-to-your-notes` | Site copy: add "or on ambernotes.app" |

**Open, for Emil to decide**

| Gap | Where | Why it matters |
|---|---|---|
| `search` and `fetch` returned `url: pane://note/<id>`, a scheme nothing handles | `tools.ts` | Fixed on `prep/directories-2`: the `url` is gone, and the search description no longer promises links |
| `search` and `search_notes` found nothing when one word of the query wasn't in the note ("Lisbon trip") | `tools.ts` search handlers | Fixed on `prep/directories-2`: a retry with any of the words (`broadenQuery` in `notes.ts`). The result says so with `no_note_has_every_word`. |
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
| restore_note | false / false / false | Brings a note back from Recently Deleted. Nothing existing is changed. |
| set_checklist_item, pin_note, move_note, rename_folder | false / true / false | Overwrites a checkbox, the pin, a note's folder or a folder's name. Being able to change it back doesn't make it additive. |
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
- **Support contact:** hello@ambernotes.app (the address on /support and in the privacy policy), https://ambernotes.app/support
- **Icon:** `brand/directory/icon-512.png`, or `icon-1024.png` if the portal asks for larger.
- **Slug (permanent):** `amber-notes`

### 4.3 Use cases
- **Primary use cases:**
  1. Find and summarize notes.
  2. Answer questions from notes.
  3. Keep lists and trackers up to date from a conversation.
  4. Write new notes from what you discuss.
- **What users need first:** an Amber Notes account, made in the iPhone or Mac app.
- **Reads or writes:** both.

Example prompts (policy 3.E asks for at least three). The expected results are for the demo account after section 7.

| # | Prompt | Expected tools | Expected result |
|---|---|---|---|
| 1 | "Find my Lisbon trip note and summarize the plan." | search_notes, read_note | Summary of "Lisbon in May" (Travel): the checklist, what's done and what's open, and the three places to eat. Nothing changes. |
| 2 | "What's the confirmation number for my Lisbon hotel?" | search_notes, read_note | "LX-48213, Casa do Príncipe in Príncipe Real, 14 to 18 May", read from the sub-note "Hotel booking". |
| 3 | "Check off 'Tram 28 early' in my Lisbon note." | set_checklist_item | The item is ticked and Claude confirms. The note's history has the previous version. |
| 4 | "Log today's run in my Running log: 5.2 km, 28 minutes, felt 4 out of 5." | read_table, log_table_row | A row for today in the tracker. A second run the same day updates that row instead of adding one. |
| 5 | "Turn my design meeting points into a checklist in a new note called Design follow-ups in Work." | read_note, create_note | A new note in Work with three unchecked items. |
| 6 | "Add 'Pack an adapter' to my Lisbon checklist." | append_to_note or edit_note | The item is added under Plan. Claude asks before any destructive edit. |
| 7 | "What did I change in my Lisbon note recently? Undo the last change." | note_history, restore_revision | Lists the versions, then restores the previous one after Claude asks. |

### 4.4 Company
- **Company:** Emil Wagman (individual developer, Sweden). Use Norditech AB only if Emil wants the listing under the company, and then change the privacy policy's controller line to match.
- **Website:** https://ambernotes.app
- **Primary contact:** hello@ambernotes.app

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
- no prompt injection in descriptions;
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
  2. Put it in `web/app/.well-known/openai-apps-challenge/route.ts`; the site deploys on merge.
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

This is the App Review account, used for the directory review as well. `scripts/review-account.py` keeps it in shape:
- `seed` adds any missing notes;
- `reset` puts back what reviewers changed;
- `check` runs the tool calls in 7.3.

The script works as that user through the public API, and it reads the password from `.secrets/appreview.txt` without printing it.

### 7.1 What changed on 2026-09-30

- Removed the stray note that was only an empty table ("— —").
- Removed the empty tables at the end of "Lisbon in May" and "Book notes". "Book flights" is now a ticked checklist item.
- Added "Running log" (a tracker), "Groceries" (pinned), "Q4 planning", "Hiring: product designer" (a tracker) and "Packing list".
- Two notes that were already in Recently Deleted, "Q4 kickoff" and an older "Groceries", are still there.

### 7.2 What's in it now

| Folder | Note | What it exercises |
|---|---|---|
| Travel | Lisbon in May | headings, a checklist (2 open, 2 done), the Where to eat table (Place, Dish, Area), the sub-note link |
| Travel | Hotel booking (sub-note of Lisbon in May) | the facts for prompt P2: Casa do Príncipe, 14 to 18 May, LX-48213 |
| Travel | Packing list | a checklist of 8 items |
| Work | Meeting with design | three bullet points for P5 |
| Work | Q4 planning | goals, risks and decisions under headings |
| Work | Hiring: product designer | a tracker with Name, Date, and a Verdict of Hire, Maybe or No |
| Personal | Running log | a tracker with Date, Distance km, Minutes and Feel (1–5), three runs from last week |
| Personal | Groceries (pinned) | a checklist |
| Personal | Book notes: The Creative Act | a quote and a list |

There are no files. `list_files` returns an empty list, and no test prompt uses files. To show files, attach a small PDF to "Lisbon in May" in the app.

### 7.3 Live check (2026-09-30, production, `scripts/review-account.py check`)

The check signs in the way Claude and ChatGPT do:
1. It registers a client and starts `/authorize` with PKCE.
2. It gets sent to ambernotes.app/connect, and allows with the demo user's session.
3. It exchanges the code for tokens (`iss` matches `https://mcp.ambernotes.app`).
4. It runs each test prompt's tool calls.
5. It then disconnects and resets the notes.

Result: 21 of 22 passed.
- **Passed:**
  - an unauthenticated call gets a 401 with `resource_metadata`;
  - 27 tools, all annotated;
  - P1 through P5;
  - the extra Claude prompts: log a run, log again on the same day (updates the row), add under Plan, history, restore;
  - get_overview, and no results for "weather forecast";
  - a bad tracker value explains the fix ("Feel must be a whole number from 1 to 5").
- **Failed:** `search` for "Lisbon trip" returns nothing, because every word has to match. The fix is on `prep/directories-2` (section 3) and needs a deploy. Run `check` again after deploying.

The negative prompts can't be checked this way. They test the assistant not calling Amber Notes, so they have to be run in ChatGPT itself (section 8, step 6).

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
4. **Demo account:** done (section 7). Before each submission or resubmission, run `scripts/review-account.py reset`, then `check`.
5. **Record the demo video** (section 6, shots 2 to 6) and upload it unlisted.
6. **Run everything before submitting:** connect Claude and ChatGPT to `https://mcp.ambernotes.app` with the demo account, and run every prompt in sections 4.3 and 5 once. Both portals ask you to confirm this.
7. **Upload the ZIP** at platform.openai.com → Plugins. Fill in Review details with the test account instructions and type the password yourself. Paste the video link, then submit.

## 9. Assets

All made from `brand/` sources with `sips`:

| File | Size | Use |
|---|---|---|
| `brand/directory/icon-1024.png` | 1024², RGB | Claude icon if larger is wanted (from `brand/icon-ios-1024.png`) |
| `brand/directory/icon-512.png` | 512², RGB | Claude icon. Also ChatGPT `logo` and `logoDark`. |
| `brand/directory/mark-512.png` | 512², transparent | Spare. The mark without its background. |
| `brand/directory/mark-128.png` | 128², transparent | ChatGPT `composerIcon` and `composerIconDark` |

Screenshots are not needed. Claude asks for them only for MCP Apps with UI, and OpenAI rejects them without UI.

## 10. MCP Registry and other directories

### 10.1 Official MCP Registry (registry.modelcontextprotocol.io)

`server.json` at the repo root is valid (`mcp-publisher validate`):
- name `app.ambernotes/amber-notes`;
- one remote, `streamable-http` at `https://mcp.ambernotes.app`;
- the repository, and the icon `https://ambernotes.app/mark-256.png`.

It publishes under DNS authentication for ambernotes.app ([authentication](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/authentication.mdx)). That grants the namespace `app.ambernotes/*`.

1. **The key** is `.secrets/mcp-registry-key.pem` in the main checkout (Ed25519, 0600, gitignored).
2. **The TXT record** goes on the apex. At GoDaddy, add a TXT record with host `@` and TTL 1 hour, and keep the existing google-site-verification record:

   ```
   v=MCPv1; k=ed25519; p=83sv2tQ57ePV8lfoNuavy9f4EWnip4oODqTR6obHO7g=
   ```

3. **Once `dig +short TXT ambernotes.app` shows it**, publish:

   ```sh
   cd <checkout with server.json>
   mcp-publisher login dns --domain ambernotes.app \
     --private-key "$(openssl pkey -in ~/Documents/Development/AmberNotes/.secrets/mcp-registry-key.pem -noout -text | grep -A3 'priv:' | tail -n +2 | tr -d ' :\n')"
   mcp-publisher publish
   ```

4. **Updates:** bump `version` in `server.json` and publish again. If the key is ever rotated, remove the old TXT record first. The registry tries a stale record first, and the login fails.

### 10.2 Smithery (smithery.ai/new)

Smithery takes a hosted server by URL and scans it after signing in ([external servers](https://smithery.ai/docs/build/external)). It says it "handles client registration automatically via Client ID Metadata Documents". Amber Notes offers dynamic client registration, not CIMD, so the scan's sign-in may fail. If it does, there are two options:
- serve a static server card at `/.well-known/mcp/server-card.json`, with `serverInfo`, `authentication` and `tools`;
- add CIMD to `oauth.ts`. OpenAI prefers CIMD too, so this is worth doing anyway.

Fields to enter:
- **URL:** `https://mcp.ambernotes.app`
- **Display name:** Amber Notes
- **Description:** Search, read and edit your notes in Amber Notes, the notes app for iPhone and Mac. Folders, checklists, tables and trackers. You choose read only or read and edit, and every change keeps the previous version.
- **Homepage:** https://ambernotes.app/blog/mcp-server
- **Repository:** https://github.com/emilwagman/amber-notes
- **Icon:** https://ambernotes.app/mark-256.png
- **Tags:** notes, productivity, checklists, apple, markdown

### 10.3 Glama (glama.ai/mcp/servers, "Add server")

Glama indexes GitHub repositories. `glama.json` at the repo root names `emilwagman` as the maintainer, which lets Emil claim the listing and edit its name and description.

Fields to enter:
- **Repository:** https://github.com/emilwagman/amber-notes
- **Name:** Amber Notes
- **Description:** same as Smithery.
- **Hosted connector URL:** `https://mcp.ambernotes.app` (Streamable HTTP, OAuth).

### 10.4 mcp.so (mcp.so/submit)

Choose the **Remote Server** type.

Fields to enter:
- **Repository URL:** https://github.com/emilwagman/amber-notes
- **Name:** Amber Notes
- **Server URL:** `https://mcp.ambernotes.app`
- **Description:** same as Smithery.

The free listing is reviewed. The $39 option skips review and adds a verified badge. It isn't needed.

