# Files in folders

Status: prototype on `proto/files-in-folders` (2026-10-06). Migrations `20261008100000_folder_files.sql` and `20261008100100_storage_limit_and_file_versions.sql`.

A folder holds notes, apps and files: "Personal/" has TODO (a note) and Habit tracker (an app); "To Read/" has Fluent Python.pdf. A file can still be embedded in a note (`pane-file:<id>`), as before.

## Data

- `attachments` gains `folder_id` (null: a file only notes embed), `trashed_at` (Recently Deleted) and `content_version` (how often its bytes were replaced). The name, type and size stay sealed in `meta_ct`; the bytes stay sealed in Storage at `<user id>/<id>`.
- `attachment_versions` keeps the last 10 versions of a file the AI replaced: the sealed meta, and the sealed bytes copied to `<user id>/<id>.v<n>`.
- Triggers: a file only goes into the owner's folder; deleting a folder (any app version, or the AI) sends its files to Recently Deleted. `pane_forget_files_daily()` (own cron job) deletes files 30 days after `trashed_at`.
- Sub-notes keep using `notes.parent_id` (since 20260928190000, set by the app and the AI on creation). Each device fills in a missing parent from the `pane-note:` link in the parent's text, once per note, and syncs it.

## Older apps

They don't send `folder_id`, `trashed_at` or `content_version`, and an upsert only updates the columns it sends, so their writes keep all three. They pull these rows and show nothing for them (they only show embedded files) and never delete files. A file the AI replaced keeps its old bytes on an older device until it's downloaded again. Storage refusals reach them like any refused write. Apply the migrations before the app ships.

## Storage per person

| Limit | Value | Where |
|---|---|---|
| Everything one person stores | 2 GB (2,147,483,648 bytes) | `pane_limit('storage_bytes')` |
| One file added in the app | 100 MB | `pane_limit('file_bytes')`, the bucket's size limit, `FileKinds.maxBytes` |
| One file the AI reads or writes | 10 MB (10,485,760 bytes; about 14 MB as base64) | `pane_limit('ai_file_bytes')`, `AI_FILE_BYTES` |
| Earlier versions per file | 10 | `pane_limit('file_versions')` |

Counted on stored (sealed) sizes: note text and heads, their versions, files and their versions, apps (code, data, drafts, versions). Recently Deleted and earlier versions count until they're deleted for good. Enforced in the database, so no client can skip it: triggers on `notes`, `note_pages` and `attachments` refuse growth at the limit (shrinking, deleting and editing down always work), the Storage upload policy refuses uploads, and the AI server checks `storage_room()` before it uploads. The total is counted again when a minute old or past 90%, and each write's growth is added at once. An account already over the limit keeps everything and can't add. `storage_usage()` gives Settings the numbers by kind.

App: Settings › Storage shows "1.86 GB of 2 GB used", a bar, and Files, Recently Deleted, Earlier versions, Notes, Apps. From 90% the list shows "Amber Notes is almost full" with what to do; at the limit, "Amber Notes is full" naming what takes the room. The AI's refusal says how much is used, by kind, and what to delete. No money amounts anywhere.

## Kinds of file

Add File, drops and the share sheet take only these; anything else is refused with a message naming the files. Audio, video and EPUB come later.

| Kind | Mac | iPhone | AI reads | AI changes |
|---|---|---|---|---|
| PDF | Quick Look | Quick Look | its text, by page (unpdf); a scan says it has no text | write (bytes) |
| JPEG, PNG, GIF, WebP | Quick Look | Quick Look | as an image | write (bytes) |
| HEIC | Quick Look | Quick Look | says it can't; raw for the bytes | write (bytes) |
| TXT, Markdown, JSON, XML, YAML, HTML, CSS, code (py, swift, js, ts, sh, sql, …) | Quick Look | Quick Look | as text with line numbers | edit and write, like a note |
| CSV, TSV | as a table | as a table | as text with line numbers | edit and write, like a note |
| Word (docx), Excel (xlsx), PowerPoint (pptx) | Quick Look | Quick Look | their text (paragraphs, sheets as rows, slides) | write (bytes) |
| Pages, Numbers, Keynote | Quick Look | Quick Look | says it can't; raw for the bytes | write (bytes) |

Every row but iWork was opened on both platforms (screenshots in `docs/Evidence/folder-files/kinds/`). No real iWork file was at hand (the only sample on the machine is a 2011 stub Quick Look refuses), so iWork rests on Quick Look's documented support.

## Deletion, Recently Deleted, history

A file in a folder goes to Recently Deleted like a note, can be recovered for 30 days (into its folder, or the default folder if that's gone), then is deleted for good with its bytes and its versions. A rename only changes the sealed name. When the AI changes a file, the version before is kept (history, restore); restoring keeps what it replaced too.

## Drag and drop

Mac: files from Finder, Mail or Safari onto a folder in the sidebar (it highlights), into a folder's list, or into an open note (attached there); a Finder folder becomes a folder with its files and sub-folders. Files drag out of the list to Finder, and onto sidebar folders to move. iPad: the same drops. iPhone: the share sheet ("Save to Amber Notes", with a folder picker); files shared without text stay files.

## What the AI can do

File tool set (`AMBER_MCP_TOOLS=files`), paths only. `list` shows a folder's notes, apps and files; `fetch` reads a file as above, or with `raw: true` returns the bytes as an embedded resource; `search` (type file) matches names; `edit` changes text files; `write` creates or replaces any file from `content` (text), `content_base64` + `mime_type`, or `file` (ChatGPT's `openai/fileParams` link); `move`, `delete`, `history`, `restore` work on files. Read before edit or write (`mcp_reads`, keyed by `content_version`).

What clients do with bytes (checked against their issue trackers and docs, October 2026; not run end to end):

| Client | Bytes out (fetch raw) | Bytes in (write) | Round trip |
|---|---|---|---|
| Claude Code (CLI) | saves the blob to a file and gives the model its path (anthropics/claude-code#72271) | base64 in the arguments: the model has to write it out, so only small files (tens of KB) | works for small files |
| claude.ai and Claude desktop (custom connectors) | fails: a `resource` with `blob` is rejected with -32602 (anthropics/claude-ai-mcp#1086, open) | base64 in the arguments, same size problem | doesn't work; text, images and extracted text do |
| ChatGPT | ignores the blob | a file from the chat via `openai/fileParams` (supported here) | upload works; download doesn't |

So the default read of a PDF or Office file is its extracted text, never a blob. Production `get_file` still returns PDFs as blobs and is affected by the claude.ai bug.
