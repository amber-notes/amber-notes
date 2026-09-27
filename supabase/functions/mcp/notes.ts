// Pure markdown helpers for the note tools. No I/O, so they are unit-tested.

export function titleOf(body: string): string {
  for (const raw of body.split("\n")) {
    const line = stripMarkup(raw);
    if (line) return line;
  }
  return "New Note";
}

export function stripMarkup(line: string): string {
  let s = line.trim();
  s = s.replace(/^#{1,6}\s+/, "").replace(/^>\s?/, "").replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, "").replace(/^\d+[.)]\s+/, "");
  if (/^(```|~~~)/.test(s) || /^[-*_|:= ]+$/.test(s)) return "";
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*|__|~~|`/g, "");
  return s.trim();
}

export function previewOf(body: string, max = 140): string {
  const lines = body.split("\n").map(stripMarkup).filter(Boolean);
  const text = lines.slice(1).join(" · ");
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

export type Edit = { old_text: string; new_text: string; replace_all?: boolean };

/** Applies exact find/replace edits in order. Throws a message the model can act on. */
export function applyEdits(body: string, edits: Edit[]): string {
  let out = body;
  edits.forEach((e, i) => {
    if (typeof e.old_text !== "string" || typeof e.new_text !== "string") {
      throw new Error(`Edit ${i + 1}: old_text and new_text are required strings.`);
    }
    if (e.old_text === "") throw new Error(`Edit ${i + 1}: old_text is empty. To add text, use append_to_note.`);
    const count = out.split(e.old_text).length - 1;
    if (count === 0) {
      throw new Error(`Edit ${i + 1}: old_text was not found. Read the note again and copy the exact text, including markdown and spacing.`);
    }
    if (count > 1 && !e.replace_all) {
      throw new Error(`Edit ${i + 1}: old_text appears ${count} times. Include more surrounding text to make it unique, or set replace_all.`);
    }
    out = e.replace_all ? out.split(e.old_text).join(e.new_text) : out.replace(e.old_text, () => e.new_text);
  });
  return out;
}

/** Appends text at the end of the note, or at the end of a heading's section. */
export function appendText(body: string, text: string, underHeading?: string, atStart = false): string {
  const addition = text.replace(/\s+$/, "");
  if (!underHeading) {
    if (atStart) {
      // After the title line, so the title stays the title.
      const lines = body.split("\n");
      const t = lines.findIndex((l) => stripMarkup(l) !== "");
      if (t < 0) return addition + "\n" + body;
      lines.splice(t + 1, 0, addition);
      return lines.join("\n");
    }
    const trimmed = body.replace(/\s+$/, "");
    return trimmed ? `${trimmed}\n${needsGap(trimmed, addition) ? "\n" : ""}${addition}\n` : addition + "\n";
  }
  const lines = body.split("\n");
  const want = normalize(underHeading);
  const h = lines.findIndex((l) => /^#{1,6}\s/.test(l) && normalize(l.replace(/^#{1,6}\s+/, "")) === want);
  if (h < 0) {
    const headings = lines.filter((l) => /^#{1,6}\s/.test(l)).map((l) => l.replace(/^#{1,6}\s+/, ""));
    throw new Error(`No heading "${underHeading}". Headings in this note: ${headings.length ? headings.join(", ") : "none"}.`);
  }
  const level = lines[h].match(/^#+/)![0].length;
  let end = lines.length;
  for (let i = h + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s/);
    if (m && m[1].length <= level) { end = i; break; }
  }
  if (atStart) {
    lines.splice(h + 1, 0, addition);
    return lines.join("\n");
  }
  // Insert after the section's last non-blank line.
  let at = end;
  while (at > h + 1 && lines[at - 1].trim() === "") at--;
  lines.splice(at, 0, addition);
  return lines.join("\n");
}

function needsGap(prev: string, next: string): boolean {
  const list = /^\s*([-*+]|\d+[.)])\s/;
  const lastLine = prev.split("\n").pop() ?? "";
  return !(list.test(lastLine) && list.test(next));
}

function normalize(s: string): string {
  return stripMarkup(s).toLowerCase().replace(/\s+/g, " ").trim();
}

/** Checks or unchecks a checklist item matched by its text. */
export function setChecklistItem(body: string, item: string, checked: boolean): { body: string; matched: string } {
  const lines = body.split("\n");
  const re = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.*)$/;
  const want = normalize(item);
  const candidates = lines.map((l, i) => ({ i, m: l.match(re) })).filter((c) => c.m);
  if (!candidates.length) throw new Error("This note has no checklist items.");
  let hits = candidates.filter((c) => normalize(c.m![4]) === want);
  if (!hits.length) hits = candidates.filter((c) => normalize(c.m![4]).includes(want));
  if (hits.length === 0) {
    throw new Error(`No checklist item matches "${item}". Items: ${candidates.map((c) => c.m![4]).join("; ")}`);
  }
  if (hits.length > 1) {
    throw new Error(`"${item}" matches ${hits.length} items: ${hits.map((c) => c.m![4]).join("; ")}. Be more specific.`);
  }
  const { i, m } = hits[0];
  lines[i] = `${m![1]}${checked ? "x" : " "}${m![3]}${m![4]}`;
  return { body: lines.join("\n"), matched: m![4] };
}

/** Returns lines [start, end] (1-based, inclusive), optionally numbered. */
export function sliceLines(body: string, start?: number, end?: number, numbered = false): string {
  const lines = body.split("\n");
  const a = Math.max(1, start ?? 1);
  const b = Math.min(lines.length, end ?? lines.length);
  const width = String(b).length;
  return lines.slice(a - 1, b).map((l, k) => (numbered ? `${String(a + k).padStart(width)}│ ${l}` : l)).join("\n");
}

/** Headings, checklist progress and size: a quick map of a long note. */
export function outline(body: string) {
  const lines = body.split("\n");
  const headings = lines.flatMap((l, i) => {
    const m = l.match(/^(#{1,6})\s+(.*)$/);
    return m ? [{ line: i + 1, level: m[1].length, text: stripMarkup(m[2]) }] : [];
  });
  const open = lines.filter((l) => /^\s*[-*+]\s+\[ \]\s/.test(l)).length;
  const done = lines.filter((l) => /^\s*[-*+]\s+\[[xX]\]\s/.test(l)).length;
  const words = body.split(/\s+/).filter(Boolean).length;
  return { headings, checklist: { open, done }, lines: lines.length, words };
}
