// Plain-text output for people; `--json` prints what the tool returned instead. Each formatter
// takes the tool's structured result; anything it doesn't recognise prints as JSON.
type R = Record<string, any>;

const when = (iso?: string | null) => iso ? iso.slice(0, 16).replace("T", " ") : "";
const pad = (s: string, n: number) => s.length >= n ? s + "  " : s + " ".repeat(n - s.length);
const checks = (r: R) => Array.isArray(r.checks) && r.checks.length ? "\n" + r.checks.map((c: string) => `  check: ${c}`).join("\n") : "";
const json = (r: unknown) => JSON.stringify(r, null, 2);

function entries(list: R[] = []): string[] {
  const w = Math.min(60, Math.max(0, ...list.map((n) => String(n.path).length)) + 2);
  return list.map((n) => `  ${pad(n.path, w)}${when(n.updated)}${n.pinned ? "  pinned" : ""}${n.locked ? "  locked" : ""}${n.app ? "  app" : ""}${n.type === "file" ? `  ${n.kind ?? "file"}` : ""}${n.deleted ? `  deleted ${when(n.deleted)}` : ""}`);
}

export const formatters: Record<string, (r: R) => string> = {
  search(r) {
    if (Array.isArray(r.results)) {
      if (!r.results.length) return "No notes match.";
      const out = r.results.map((x: R) => `${x.id}\n  ${String(x.snippet ?? "").replace(/\s+/g, " ").trim()}`);
      if (r.no_note_has_every_word) out.unshift("No note has every word; these have some.\n");
      return [...out, ...(r.more ? [r.more] : []), ...(r.searched ? [`(searched ${r.searched})`] : [])].join("\n");
    }
    if (Array.isArray(r.lines)) return [...r.lines, ...(r.more ? [r.more] : [])].join("\n") || "No matches.";
    if (Array.isArray(r.files)) return [...r.files, ...(r.more ? [r.more] : [])].join("\n") || "No matches.";
    if (typeof r.matches === "number") return `${r.matches} matches${r.notes !== undefined ? ` in ${r.notes} notes` : ""}`;
    return json(r);
  },

  list(r) {
    if (Array.isArray(r.entries) || Array.isArray(r.matches)) {
      const list = (r.entries ?? r.matches) as R[];
      const out = [r.path ?? r.pattern, ...entries(list)];
      if (!list.length) out.push("  (empty)");
      if (r.more) out.push(r.more);
      if (r.recently_deleted) out.push(`(${r.recently_deleted})`);
      return out.join("\n");
    }
    if (Array.isArray(r.files)) return [...r.files.map((f: R) => `  ${f.path}${f.what ? `  (${f.what})` : ""}`), ...(r.more ? [r.more] : [])].join("\n");
    return json(r);
  },

  create: (r) => r.created ? `Created ${r.created}${r.next ? `\n${r.next}` : ""}${checks(r)}` : r.app ? `Created ${r.app}${r.next ? `\n${r.next}` : ""}` : json(r),
  edit: (r) => r.unchanged ? `No change to ${r.path}.` : r.edited ? `Edited ${r.edited}${checks(r)}` : r.saved ? `Saved ${r.saved}${r.live ? `\n${r.live}` : ""}` : json(r),
  write: (r) => r.unchanged ? `No change to ${r.path}.` : r.written ? `Wrote ${r.written}${checks(r)}` : r.created ? `Created ${r.created}${checks(r)}` : r.saved ? `Saved ${r.saved}${r.live ? `\n${r.live}` : ""}` : json(r),
  move: (r) => r.moved ? `Moved to ${r.moved}` : json(r),
  delete(r) {
    if (typeof r.deleted !== "string") return json(r);
    if (r.now_at) return `Moved ${r.deleted} to ${r.now_at}${r.with_sub_notes ? ` with ${r.with_sub_notes} sub-note${r.with_sub_notes > 1 ? "s" : ""}` : ""}. Bring it back with: amber restore ${JSON.stringify(r.now_at)}`;
    return `Deleted ${r.deleted}${r.notes_moved_to ? `; its notes went to ${r.notes_moved_to}` : ""}`;
  },
  history(r) {
    if (!Array.isArray(r.versions)) return json(r);
    if (!r.versions.length) return `${r.path} has no earlier versions.`;
    return [`${r.path}: earlier versions, newest first:`, ...r.versions.map((v: R) =>
      v.what ? `  ${pad(String(v.version), 8)}${pad(v.what, 6)}${pad(when(v.made), 18)}${v.made_by ?? ""}`
        : `  ${pad(String(v.version), 8)}${pad(when(v.replaced_at), 18)}${pad(String(v.replaced_by ?? ""), 18)}${v.locked ? "(locked)" : v.title}`),
      "", "Bring one back with: amber restore <note> <version>"].join("\n");
  },
  restore: (r) => typeof r.restored === "string" ? `Restored ${r.restored}${r.version ? ` (version ${r.version})` : ""}.` : json(r),
  pin: (r) => `${r.pinned ? "Pinned" : "Unpinned"} ${r.path}`,
};

/** cat -n lines ("     3\tText") back to the text itself. */
export const unnumbered = (text: string) => /^ *\d+\t/.test(text) ? text.split("\n").map((l) => l.replace(/^ *\d+\t/, "")).join("\n") : text;

/** A note's text for `amber read`, exactly as stored; folders and other things fall back to their text. */
export function readText(r: R, numbers = false): string {
  return typeof r.text === "string" ? (numbers ? r.text : unnumbered(r.text)) : json(r);
}

export function format(tool: string, r: unknown): string {
  if (typeof r !== "object" || r === null) return String(r);
  const f = formatters[tool];
  try { return f ? f(r as R) : json(r); } catch { return json(r); }
}
