# Files in folders

Status: prototype on `proto/files-in-folders` (2026-10-06). Migration `20261007165000_folder_files.sql`.

A folder holds notes, apps and files: PDFs, images, spreadsheets, any type the app can import. A "To read" folder of PDFs is the example. A file can still be embedded in a note (`pane-file:<id>`), as before.

## Data

- `public.attachments` gains `folder_id` (null: a file that only lives inside notes) and `trashed_at` (Recently Deleted). Nothing else changes: the name, type and size stay sealed in `meta_ct` (context `file-meta:<id>`), the bytes stay sealed in Storage at `<user id>/<id>`.
- A trigger refuses a `folder_id` that isn't one of the owner's folders.
- Deleting a folder (any app version, or the AI) sets `trashed_at` on its files, by trigger.
- `pane_forget_files_daily()` (pg_cron, 03:29) sets `deleted_at` 30 days after `trashed_at`.

## Sync and older apps

The apps send `folder_id` and `trashed_at` with every upsert of a file. Older builds send neither, and a PostgREST upsert only updates the columns it sends, so their writes never move a file out of its folder or out of Recently Deleted. Older builds pull these rows and show nothing for them: they only show files a note embeds. They never delete files, so a file in a folder is safe on an older device. Apply the migration before shipping an app that sends the new columns.

A device that purges a file (Delete Forever, or 30 days) uploads the tombstone, then removes the Storage object. A device that pulls a tombstone for a file it had removes its copy and the Storage object if it's still there (the cron purge has no device). A rename moves the local copy, whose path includes the name.

## Sizes and limits

Unchanged: 50 MB per upload, 10,000 files and 500 MB per account (counted from Storage by the upload policy). The AI reads files up to 8 MB.

## Deletion, Recently Deleted, history

A file goes to Recently Deleted like a note, is listed there with notes, can be recovered for 30 days (back into its folder, or the default folder if that's gone), then is deleted for good with its bytes. Files have no version history; a rename only changes the sealed name.

## What the apps show

- The note list mixes notes and files, grouped by date like notes. A file row has its name, date, kind and size, and a thumbnail (first page of a PDF, the picture) on the trailing side where Notes shows a note's picture; other kinds show their icon.
- Selecting a file opens it in Quick Look in the detail column (PDFs scroll and zoom), with Share, Rename, Move to and Delete.
- Add File: iPhone toolbar button, Mac list "..." menu, and drag and drop onto the Mac list (text and markdown still become notes).
- Share sheet: "Save to Amber Notes" picks a folder. Files shared without text are kept there as files; text becomes a note there.
- Sidebar counts include files. Multi-select move and delete work across notes and files.

## What the AI can do

In the file-like tool set (`AMBER_MCP_TOOLS=files`): a file in a folder is `To read/Paper.pdf`. `list` shows a folder's files and Recently Deleted's; `fetch` reads one (text inline, images as images, PDFs as a resource, as `get_file` does); `search` matches file names; `move` moves or renames (same ending); `delete` sends it to Recently Deleted; `restore` brings it back. Two files with one name in a folder read `Paper.pdf` and `Paper (2).pdf` (oldest keeps the name). A file embedded in a note keeps its `pane-file:<id>` handle and changes through the note. In the production tools, `list_files` and `get_file` name a file's folder, and `list_files` leaves out Recently Deleted. Creating files through the AI waits.

## Open questions

- Should a file's contents (PDF text) be searchable? Today only names are, on both sides.
- Note attachments as `Work/Acme/contract.pdf` paths: coordinated with the note-pages-ai path model, not built here.
