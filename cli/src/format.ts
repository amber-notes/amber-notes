// Plain-text output for people; `--json` prints what the tool returned instead. Each formatter
// takes the tool's structured result; anything it doesn't recognise prints as JSON.
type R = Record<string, any>;

const when = (iso?: string | null) => iso ? iso.slice(0, 16).replace("T", " ") : "";
const pad = (s: string, n: number) => s.length >= n ? s + "  " : s + " ".repeat(n - s.length);
const checks = (r: R) => Array.isArray(r.checks) && r.checks.length ? "\n" + r.checks.map((c: string) => `  check: ${c}`).join("\n") : "";
const json = (r: unknown) => JSON.stringify(r, null, 2);

function entries(list: R[] = []): string[] {
  const w = Math.min(60, Math.max(0, ...list.map((n) => String(n.path).length)) + 2);
  return list.map((n) => `  ${pad(n.path, w)}${when(n.updated)}${n.pinned ? "  pinned" : ""}${n.locked ? "  locked" : ""}${n.app ? "  app" : ""}${n.deleted ? `  deleted ${when(n.deleted)}` : ""}`);
}

export const formatters: Record<string, (r: R) => string> = {
  search(r) {
    if (!r.results?.length) return "No notes match.";
    const out = r.results.map((x: R) => `${x.path}\n  ${String(x.snippet ?? "").replace(/\s+/g, " ").trim()}`);
    if (r.no_note_has_every_word) out.unshift("No note has every word; these have some.\n");
    return out.join("\n");
  },

  list(r) {
    if (Array.isArray(r.notes) && r.notes.length && "version" in r.notes[0]) {
      return [...(r.folders ?? []).map((f: string) => f), ...entries(r.notes).map((l) => l.trim())].join("\n");
    }
    if (typeof r.notes === "number") {
      const out = [`${r.notes} notes${r.recently_deleted ? `, ${r.recently_deleted} in Recently Deleted` : ""}`];
      if (r.folders?.length) out.push("", "Folders", ...r.folders.map((f: R) => `  ${pad(f.path, 30)}${f.notes}`));
      if (r.pinned?.length) out.push("", "Pinned", ...entries(r.pinned));
      if (r.recently_edited?.length) out.push("", "Recently edited", ...entries(r.recently_edited));
      return out.join("\n");
    }
    if (Array.isArray(r.files)) return r.files.map((f: R) => `  ${f.path}${f.what ? `  (${f.what})` : ""}`).join("\n");
    if (r.sub_notes) return [r.path, ...entries(r.sub_notes), ...(r.app ? [`  ${r.app}`] : [])].join("\n");
    const out = [r.path];
    for (const f of r.folders ?? []) out.push(`  ${f}`);
    out.push(...entries(r.notes));
    if (out.length === 1) out.push("  (empty)");
    return out.join("\n");
  },

  create: (r) => r.created ? `Created ${r.created}${r.next ? `\n${r.next}` : ""}${checks(r)}` : json(r),
  edit: (r) => r.unchanged ? `No change to ${r.path}.` : r.edited ? `Edited ${r.edited} (version ${r.version})${checks(r)}` : r.saved ? `Saved ${r.app}: ${r.saved}` : json(r),
  write: (r) => r.unchanged ? `No change to ${r.path}.` : r.written ? `Wrote ${r.written} (version ${r.version})${checks(r)}` : r.saved ? `Saved ${r.app}: ${r.saved}` : json(r),
  move: (r) => r.moved ? `Moved to ${r.moved}` : json(r),
  delete(r) {
    const d = r.deleted;
    if (d && typeof d === "object" && d.title) return `Moved "${d.title}" to Recently Deleted${d.sub_notes_moved ? ` with ${d.sub_notes_moved} sub-note${d.sub_notes_moved > 1 ? "s" : ""}` : ""}. Bring it back with: amber restore ${d.id}`;
    if (d && typeof d === "object" && "notes_moved_to_recently_deleted" in d) return `Deleted the folder; ${d.notes_moved_to_recently_deleted} notes went to Recently Deleted.`;
    return typeof d === "string" ? `Deleted ${d}` : json(r);
  },
  history(r) {
    if (Array.isArray(r.revisions)) {
      if (!r.revisions.length) return `"${r.title}" has no earlier versions.`;
      return [`"${r.title}", now version ${r.current_version}. Earlier versions, newest first:`, ...r.revisions.map((v: R) =>
        `  ${pad(String(v.version), 8)}${pad(when(v.replaced_at), 18)}${pad(String(v.replaced_by ?? ""), 18)}${v.locked ? "(locked)" : v.title}`), "", "Bring one back with: amber restore <note> <version>"].join("\n");
    }
    if (Array.isArray(r.versions)) return [`${r.app} (app)`, ...r.versions.map((v: R) => `  ${pad(String(v.version), 8)}${pad(v.what, 6)}${pad(when(v.made), 18)}${v.made_by ?? ""}`)].join("\n");
    return json(r);
  },
  restore(r) {
    const x = r.restored;
    if (x && typeof x === "object") return `Restored "${x.title}"${x.restored_to ? ` to ${x.restored_to}/` : ""}${x.version ? ` (now version ${x.version})` : ""}.${x.already_restored ? " It wasn't deleted." : ""}`;
    return typeof x === "string" ? `Restored ${x}.` : json(r);
  },
  pin: (r) => `${r.pinned ? "Pinned" : "Unpinned"} ${r.path}`,
};

/** A note's text for `amber read`, exactly as stored; folders and other things fall back to their text. */
export function readText(r: R): string {
  return typeof r.text === "string" ? r.text : json(r);
}

export function format(tool: string, r: unknown): string {
  if (typeof r !== "object" || r === null) return String(r);
  const f = formatters[tool];
  try { return f ? f(r as R) : json(r); } catch { return json(r); }
}
