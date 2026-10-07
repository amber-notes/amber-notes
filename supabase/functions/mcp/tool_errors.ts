// Why a tool call came back as an error to the model (a ToolError), as one fixed word.
//
// A ToolError's message goes back to the model and can quote a note's title or text, so it is
// never logged. This names its kind instead, from the fixed part of the message, so the logs can
// say "edit_note: old_text_not_found" without saying what was looked for. scripts/ops/daily-digest.ts
// counts these.

const KINDS: [RegExp, string][] = [
  // The file tools (AMBER_MCP_TOOLS=files): paths, old_string/new_string, read before edit.
  [/old_string isn't in /, "old_text_not_found"],
  [/old_string is in .+ \d+ times/, "old_text_repeated"],
  [/old_string is empty|old_string and new_string are the same|edit takes path, old_string/, "bad_edits"],
  [/changed since you read it/, "version_conflict"],
  [/with fetch before changing it/, "not_read_first"],
  [/^Nothing at "|^No such note\.|isn't a note\.|^No app at|has no app\./, "path_not_found"],
  [/already exists|already has an app/, "already_exists"],
  [/isn't text/, "not_text"],
  [/old_text was not found/, "old_text_not_found"],
  [/old_text appears \d+ times/, "old_text_repeated"],
  [/old_text is empty|old_text and new_text are required|edits must be a non-empty list/, "bad_edits"],
  [/changed since version/, "version_conflict"],
  [/notes are titled|matches several folders/, "ambiguous_title"],
  [/isn't a note id|No note with id|No note titled|Give the note's id/, "note_not_found"],
  [/can't be opened with this connection's key/, "key_mismatch"],
  [/locked/, "locked"],
  [/Recently Deleted/, "in_trash"],
  [/read-only/, "read_only"],
  [/still running|searched a lot/, "rate_limited"],
  [/No folder|Folder name/, "folder"],
  [/past the end|at or after start_line|must be a whole number/, "bad_range"],
  [/ MB/, "too_large"],
  [/is empty/, "empty_input"],
];

export function toolErrorKind(message: string): string {
  for (const [re, kind] of KINDS) if (re.test(message)) return kind;
  return "other";
}
