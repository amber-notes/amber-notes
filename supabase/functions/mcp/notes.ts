// Pure markdown helpers for the note tools. No I/O, so they are unit-tested.

export function titleOf(body: string): string {
  for (const raw of body.split("\n")) {
    const line = stripMarkup(raw);
    if (line) return line;
  }
  return "New Note";
}

export function stripMarkup(line: string): string {
  let s = line.replace(/<\/?[a-zA-Z][^>]*>/g, "").trim();
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

// MARK: Typed tables
// A markdown table preceded by <!-- pane-table: Col=type; ... --> (types: text, number, date,
// scale a-b, choice A|B|C). Same format as the app's TypedTable.

export type ColType = { kind: "text" | "number" | "date" } | { kind: "scale"; min: number; max: number } | { kind: "choice"; options: string[] };
export type Table = { columns: { name: string; type: ColType }[]; rows: string[][]; start: number; end: number };

export function parseType(s: string): ColType {
  const t = s.trim();
  const l = t.toLowerCase();
  if (l === "number" || l === "date") return { kind: l };
  const sc = t.match(/^scale\s*(\d+)\s*-\s*(\d+)/i);
  if (sc) return { kind: "scale", min: +sc[1], max: +sc[2] };
  if (l.startsWith("choice")) {
    const options = t.slice(6).split("|").map((o) => o.trim()).filter(Boolean);
    if (options.length) return { kind: "choice", options };
  }
  return { kind: "text" };
}

export function typeSpec(t: ColType): string {
  return t.kind === "scale" ? `scale ${t.min}-${t.max}` : t.kind === "choice" ? `choice ${t.options.join("|")}` : t.kind;
}

export function tableCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
    if (s[i] === "|") { out.push(cur.trim()); cur = ""; continue; }
    cur += s[i];
  }
  out.push(cur.trim());
  return out;
}

export function findTables(body: string): Table[] {
  const lines = body.split("\n");
  const out: Table[] = [];
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i].trim();
    if (!(c.startsWith("<!--") && c.endsWith("-->") && c.includes("pane-table:"))) continue;
    const spec = c.slice(c.indexOf("pane-table:") + 11, c.lastIndexOf("-->"));
    const types = new Map<string, ColType>();
    for (const part of spec.split(";")) {
      const eq = part.indexOf("=");
      if (eq > 0) types.set(part.slice(0, eq).trim().toLowerCase(), parseType(part.slice(eq + 1)));
    }
    let j = i + 1;
    const tl: string[] = [];
    while (j < lines.length && lines[j].trim().startsWith("|")) tl.push(lines[j++]);
    if (tl.length < 2) continue;
    const header = tableCells(tl[0]);
    const columns = header.map((name) => ({ name, type: types.get(name.toLowerCase()) ?? { kind: "text" as const } }));
    const rows = tl.slice(1).filter((l) => !/^[\s|:-]+$/.test(l)).map((l) => {
      const c = tableCells(l);
      return columns.map((_, k) => c[k] ?? "");
    });
    out.push({ columns, rows, start: i, end: j - 1 });
    i = j - 1;
  }
  return out;
}

export function tableMarkdown(t: Table): string {
  const cell = (v: string) => (v === "" ? " " : v.replace(/\|/g, "\\|").replace(/\n/g, " "));
  const row = (c: string[]) => "| " + c.map(cell).join(" | ") + " |";
  return [
    "<!-- pane-table: " + t.columns.map((c) => `${c.name}=${typeSpec(c.type)}`).join("; ") + " -->",
    row(t.columns.map((c) => c.name)),
    "|" + t.columns.map(() => " --- ").join("|") + "|",
    ...t.rows.map(row),
  ].join("\n");
}

export function replaceTable(body: string, t: Table): string {
  const lines = body.split("\n");
  lines.splice(t.start, t.end - t.start + 1, ...tableMarkdown(t).split("\n"));
  return lines.join("\n");
}

/** Checks and normalises a value for a column; throws a message the model can fix. */
export function coerce(value: unknown, col: { name: string; type: ColType }, today: string): string {
  if (value === null || value === undefined || value === "") return "";
  const s = String(value).trim();
  const t = col.type;
  switch (t.kind) {
    case "number": {
      const n = Number(s.replace(",", "."));
      if (!Number.isFinite(n)) throw new Error(`${col.name} must be a number (got "${s}").`);
      return String(n);
    }
    case "scale": {
      const n = Number(s);
      if (!Number.isInteger(n) || n < t.min || n > t.max) throw new Error(`${col.name} must be a whole number from ${t.min} to ${t.max} (got "${s}").`);
      return String(n);
    }
    case "choice": {
      const hit = t.options.find((o) => o.toLowerCase() === s.toLowerCase());
      if (!hit) throw new Error(`${col.name} must be one of ${t.options.join(", ")} (got "${s}").`);
      return hit;
    }
    case "date": {
      if (s.toLowerCase() === "today") return today;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`${col.name} must be a date like 2026-09-27 (got "${s}").`);
      return s;
    }
    default:
      return s;
  }
}
