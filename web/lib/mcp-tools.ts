/// The tools the Amber Notes MCP server offers, as supabase/functions/mcp/tools.ts defines them.
/// A test keeps this list in step with the server. "read" tools are all a read-only connection sees.
export type McpTool = { name: string; title: string; description: string; kind: "read" | "write" | "destructive" };

export const MCP_TOOLS: McpTool[] = [
  { name: "get_overview", title: "Overview of the notes", kind: "read", description: "An overview of the person's Amber Notes: folders with counts, pinned notes and the most recently edited notes." },
  { name: "search_notes", title: "Search notes", kind: "read", description: "Full-text search across titles and bodies. Returns ranked notes with a highlighted snippet («match»)." },
  { name: "list_notes", title: "List notes", kind: "read", description: "List notes, newest first, optionally in one folder. Use for browsing; use search_notes to find something." },
  { name: "read_note", title: "Read a note", kind: "read", description: "Returns a note's markdown with its folder, dates, version and outline. For long notes, read a line range; set line_numbers to see where headings are." },
  { name: "create_note", title: "Create a note", kind: "write", description: "Creates a note from markdown. The first line becomes the title (write it as plain text or '# Title')." },
  { name: "edit_note", title: "Edit a note", kind: "destructive", description: "Precise edits: each old_text must match the note exactly once (copy it from read_note) and is replaced by new_text. Edits apply in order. Fails without changing anything if one doesn't match." },
  { name: "append_to_note", title: "Add to a note", kind: "write", description: "Adds markdown to the end of a note, or to the end (or start) of the section under a heading. Good for logs, lists and journals." },
  { name: "replace_note_body", title: "Rewrite a note", kind: "destructive", description: "Replaces the whole note with new markdown. Use only for full rewrites; prefer edit_note. The person sees the change in Amber Notes with Undo, and the old version stays in history." },
  { name: "set_checklist_item", title: "Tick a checklist item", kind: "write", description: "Checks or unchecks a '- [ ] item' line, matched by its text." },
  { name: "move_note", title: "Move a note", kind: "write", description: "Moves a note to another folder, creating the folder if it doesn't exist. Use a path like \"Work/Clients\" to nest." },
  { name: "pin_note", title: "Pin or unpin", kind: "write", description: "Pins a note to the top of the list, or unpins it. Pinned state shows as `pinned` in every note listing." },
  { name: "delete_note", title: "Delete a note", kind: "destructive", description: "Moves a note and its sub-notes to Recently Deleted. This can be undone: restore_note brings it back within 30 days." },
  { name: "restore_note", title: "Restore a deleted note", kind: "write", description: "Brings a note (and its sub-notes) back from Recently Deleted." },
  { name: "list_folders", title: "List folders", kind: "read", description: "All folders as paths like \"Work/Q4 planning\", with how many notes each shows in the app." },
  { name: "create_folder", title: "Create a folder", kind: "write", description: "Creates a folder; use a path like \"Work/Clients\" to nest it." },
  { name: "rename_folder", title: "Rename a folder", kind: "write", description: "Renames a folder in place. Its notes and sub-folders stay inside it." },
  { name: "delete_folder", title: "Delete a folder", kind: "destructive", description: "Deletes a folder and its sub-folders. Their notes (and those notes' sub-notes) go to Recently Deleted, and each can be brought back with restore_note within 30 days; the folders themselves are not restored." },
  { name: "note_history", title: "Note history", kind: "read", description: "Earlier versions of a note, newest first, with who changed it (app or an AI client)." },
  { name: "restore_revision", title: "Restore an earlier version", kind: "destructive", description: "Puts an earlier version (from note_history) back as the note's body. The current body is kept in history too." },
  { name: "create_sub_note", title: "Create a sub-note", kind: "write", description: "Creates a note that lives inside another note: it's linked from the parent (a [Title](pane-note:id) line added at the end, or under a heading) and doesn't show in the main list." },
  { name: "list_files", title: "List files", kind: "read", description: "Files kept in Amber Notes (PDFs, spreadsheets, images…), newest first, with the notes that embed them." },
  { name: "get_file", title: "Get a file", kind: "read", description: "Details of a file and a download link valid for 10 minutes, so you can fetch and read it (PDF, spreadsheet, image…)." },
  { name: "read_table", title: "Read a table", kind: "read", description: "Reads a table in a note: its columns (with types and allowed values for trackers) and its rows as objects. Use before logging so you use the right column names and values." },
  { name: "log_table_row", title: "Log a row", kind: "destructive", description: "Adds a row to a table. In a tracker with a date column it updates that date's row if there is one (the date defaults to today). Values are checked against each column's type: scales must be in range, choices one of the options, Yes/No also takes true/false." },
  { name: "delete_table_row", title: "Delete a row", kind: "destructive", description: "Removes the row for a date (trackers) or at a 0-based row index from a table." },
  { name: "search", title: "Search", kind: "read", description: "Search the person's Amber Notes by words or phrases. Returns note ids and titles; read one with fetch." },
  { name: "fetch", title: "Fetch", kind: "read", description: "Fetch an Amber Notes note by id (from search) as its full markdown, with folder, pinned state and last edit time." },
];
