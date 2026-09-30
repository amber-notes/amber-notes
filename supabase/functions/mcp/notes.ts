// Pure markdown helpers for the note tools. No I/O, so they are unit-tested.

export function titleOf(body: string): string {
  for (const raw of body.split("\n")) {
    const line = stripMarkup(raw);
    if (line) return line;
  }
  return "New Note";
}

/** Same rules as the app's NoteText.stripMarkup and the database's note_title. */
export function stripMarkup(line: string): string {
  let s = line.replace(/<\/?[a-zA-Z][^>]*>/g, "").replace(/^[ \t\r]+|[ \t\r]+$/g, "");
  s = s.replace(/^(#{1,6} |> |- \[[ xX]\] |[-*+] )/, "").replace(/^\d+[.)] /, "");
  if (s.startsWith("```") || /^[-*_|:= ]*$/.test(s)) return "";
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*|__|~~|`/g, "");
  s = s.replace(/(?<![\w*])[*_](?=\S)(.+?)(?<=\S)[*_](?![\w*])/g, "$1");
  if (s.startsWith("|")) s = s.split("|").map((c) => c.trim()).filter(Boolean).join("  ");
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
  return { body: sortChecklist(lines, i).join("\n"), matched: m![4] };
}

/**
 * Like the app: ticked items sink below the open ones. Reorders the run of same-indent
 * checklist lines around line `at` (open first, then ticked, each in written order).
 * A nested list right after the run belongs to its last item, so then nothing moves.
 */
export function sortChecklist(lines: string[], at: number): string[] {
  const item = /^(\s*)[-*+]\s+\[([ xX])\]\s/;
  const mine = lines[at]?.match(item);
  if (!mine) return lines;
  const indent = mine[1];
  const same = (k: number) => { const m = lines[k]?.match(item); return m && m[1] === indent ? m : null; };
  let lo = at, hi = at;
  while (lo > 0 && same(lo - 1)) lo--;
  while (hi + 1 < lines.length && same(hi + 1)) hi++;
  const next = lines[hi + 1]?.match(/^(\s*)([-*+]|\d+[.)])\s/);
  if (next && next[1].length > indent.length) return lines;
  const run = lines.slice(lo, hi + 1);
  const open = run.filter((l) => l.match(item)![2] === " ");
  const done = run.filter((l) => l.match(item)![2] !== " ");
  return [...lines.slice(0, lo), ...open, ...done, ...lines.slice(hi + 1)];
}

/** Returns lines [start, end] (1-based, inclusive), optionally numbered. */
export function sliceLines(body: string, start?: number, end?: number, numbered = false): string {
  const lines = body.split("\n");
  const a = Math.max(1, start ?? 1);
  const b = Math.min(lines.length, end ?? lines.length);
  const width = String(b).length;
  return lines.slice(a - 1, b).map((l, k) => (numbered ? `${String(a + k).padStart(width)}│ ${l}` : l)).join("\n");
}

/** The leading whole lines of `text` that fit in `max` characters, so one tool result stays a
 *  readable size. A single line longer than `max` is cut. */
export function fitLines(text: string, max: number): { text: string; lines: number; truncated: boolean } {
  if (text.length <= max) return { text, lines: text.split("\n").length, truncated: false };
  const cut = text.lastIndexOf("\n", max);
  const kept = cut > 0 ? text.slice(0, cut) : text.slice(0, max);
  return { text: kept, lines: kept.split("\n").length, truncated: true };
}

// Words that describe the request rather than what's in the note ("my Lisbon trip note").
const FILLER = new Set(["a", "an", "the", "my", "our", "note", "notes", "about", "in", "on", "of", "for", "to", "and", "with", "from"]);

/** A search where every word must match found nothing: the same search with any one word enough
 *  ("lisbon or trip"), without filler words. Null when the query already uses search syntax or
 *  there is nothing to widen. */
export function broadenQuery(q: string): string | null {
  if (/"|(^|\s)-|\bor\b/i.test(q)) return null;
  const words = [...new Set(q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && !FILLER.has(w)))];
  const broad = words.join(" or ");
  return broad && broad !== q.trim().toLowerCase() ? broad : null;
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
/** `typed` tables have a <!-- pane-table: … --> line; plain ones are ordinary markdown tables (all text). */
export type Table = { columns: { name: string; type: ColType }[]; rows: string[][]; start: number; end: number; typed: boolean };

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

/**
 * Every table in the note, in order, the way the app finds them: a header row followed by a
 * delimiter row, optionally with a <!-- pane-table: … --> line right above it that types the
 * columns. Tables inside code blocks are examples and are skipped.
 */
export function findTables(body: string): Table[] {
  const lines = body.split("\n");
  const out: Table[] = [];
  const isRow = (k: number) => k < lines.length && lines[k].trim().startsWith("|");
  const isDelimiter = (k: number) => { const t = lines[k]?.trim() ?? ""; return t.startsWith("|") && t.includes("-") && /^[|\-: \t]+$/.test(t); };
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i].trim();
    if (c.startsWith("```") || c.startsWith("~~~")) { inCode = !inCode; continue; }
    if (inCode || !isRow(i) || !isDelimiter(i + 1)) continue;
    const above = i > 0 ? lines[i - 1].trim() : "";
    const typed = above.startsWith("<!--") && above.endsWith("-->") && above.includes("pane-table:");
    const types = new Map<string, ColType>();
    if (typed) {
      for (const part of above.slice(above.indexOf("pane-table:") + 11, above.lastIndexOf("-->")).split(";")) {
        const eq = part.indexOf("=");
        if (eq > 0) types.set(part.slice(0, eq).trim().toLowerCase(), parseType(part.slice(eq + 1)));
      }
    }
    let j = i;
    while (isRow(j)) j++;
    const header = tableCells(lines[i]);
    const columns = header.map((name) => ({ name, type: types.get(name.toLowerCase()) ?? { kind: "text" as const } }));
    const rows = lines.slice(i + 1, j).filter((l) => !/^[\s|:-]+$/.test(l)).map((l) => {
      const cells = tableCells(l);
      return columns.map((_, k) => cells[k] ?? "");
    });
    out.push({ columns, rows, start: typed ? i - 1 : i, end: j - 1, typed });
    i = j - 1;
  }
  return out;
}

export function tableMarkdown(t: Table): string {
  const cell = (v: string) => (v === "" ? " " : v.replace(/\|/g, "\\|").replace(/\n/g, " "));
  const row = (c: string[]) => "| " + c.map(cell).join(" | ") + " |";
  // Like the app: the type line is written only when a column has a type.
  const typed = t.typed || t.columns.some((c) => c.type.kind !== "text");
  return [
    ...(typed ? ["<!-- pane-table: " + t.columns.map((c) => `${c.name}=${typeSpec(c.type)}`).join("; ") + " -->"] : []),
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
      // Yes/No columns (the app shows them as checkboxes) also take true/false.
      const yes = t.options.find((o) => o.toLowerCase() === "yes"), no = t.options.find((o) => o.toLowerCase() === "no");
      if (yes && no && typeof value === "boolean") return value ? yes : no;
      if (yes && no && /^(true|✓|x|1)$/i.test(s)) return yes;
      if (yes && no && /^(false|0)$/i.test(s)) return no;
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

// MARK: Search, in memory
// Notes are sealed, so the database can't search them: the server opens them for one request and
// matches here. The syntax is websearch_to_tsquery's (what search_notes took before): words must
// all match, "quoted phrases" match in order, OR between words means either, -word excludes.
// Words match whole and case-insensitively; a query that appears as-is anywhere in the text (a part
// of a word, or punctuation such as % and _, taken literally) matches too.

type Term = string[]; // lowercase words; more than one is a phrase
export type ParsedQuery = { groups: Term[][]; none: Term[]; raw: string };
export type SearchDoc = { title: string; body: string; updated_at: Date | string };
export type SearchHit<T extends SearchDoc> = { doc: T; rank: number; snippet: string };

const WORD = /[\p{L}\p{N}]+/gu;
const wordsOf = (s: string) => s.toLowerCase().match(WORD) ?? [];

export function parseQuery(q: string): ParsedQuery {
  const groups: Term[][] = [];
  const none: Term[] = [];
  let or = false;
  for (const m of q.matchAll(/(-?)"([^"]*)"?|(\S+)/g)) {
    let text = m[3] ?? m[2];
    let exclude = m[1] === "-";
    if (m[3] !== undefined) {
      if (/^or$/i.test(m[3])) { or = groups.length > 0; continue; }
      if (m[3].startsWith("-") && m[3].length > 1) { exclude = true; text = m[3].slice(1); }
    }
    const term = wordsOf(text);
    if (!term.length) continue;
    if (exclude) none.push(term);
    else if (or) groups[groups.length - 1].push(term);
    else groups.push([term]);
    or = false;
  }
  return { groups, none, raw: q.trim() };
}

type Prepared = { words: string[]; counts: Map<string, number>; titleWords: string[]; titleCounts: Map<string, number>; lower: string; lowerTitle: string };
const prepared = new WeakMap<SearchDoc, Prepared>();

function prepare(d: SearchDoc): Prepared {
  let p = prepared.get(d);
  if (!p) {
    const words = wordsOf(d.title + "\n" + d.body);
    const titleWords = wordsOf(d.title);
    p = { words, counts: tally(words), titleWords, titleCounts: tally(titleWords), lower: (d.title + "\n" + d.body).toLowerCase(), lowerTitle: d.title.toLowerCase() };
    prepared.set(d, p);
  }
  return p;
}

function tally(words: string[]) {
  const m = new Map<string, number>();
  for (const w of words) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
}

function count(t: Term, words: string[], counts: Map<string, number>): number {
  if (t.length === 1) return counts.get(t[0]) ?? 0;
  if (!t.every((w) => counts.has(w))) return 0;
  let n = 0;
  for (let i = 0; i + t.length <= words.length; i++) if (t.every((w, k) => words[i + k] === w)) n++;
  return n;
}

/** How well `d` matches, or null when it doesn't. */
function score(q: ParsedQuery, d: SearchDoc): number | null {
  const p = prepare(d);
  if (q.none.some((t) => count(t, p.words, p.counts) > 0)) return null;
  const literal = q.raw !== "" && p.lower.includes(q.raw.toLowerCase());
  let body = 0, inTitle = 0;
  for (const g of q.groups) {
    const best = Math.max(...g.map((t) => count(t, p.words, p.counts)));
    if (best === 0 && !literal) return null;
    body += Math.min(best, 10) / 10;
    if (g.some((t) => count(t, p.titleWords, p.titleCounts) > 0)) inTitle++;
  }
  if (!q.groups.length && !literal && !q.none.length) return null;
  const groups = Math.max(q.groups.length, 1);
  return body / groups + (2 * inTitle) / groups + (q.raw && p.lowerTitle.includes(q.raw.toLowerCase()) ? 1 : 0) + (literal ? 0.5 : 0);
}

/** Whether a note could be in the results of `query` or of its broadened form (for keeping only
 *  those while scanning). */
export function searchFilter(query: string): (d: SearchDoc) => boolean {
  const strict = parseQuery(query);
  const broad = broadenQuery(query);
  const wide = broad ? parseQuery(broad) : null;
  return (d) => score(strict, d) !== null || (wide !== null && score(wide, d) !== null);
}

/** Ranked matches with highlighted snippets, best first, newest first on ties. When nothing has
 *  every word, the broadened query's matches, with `broad` saying what was searched. */
export function searchInMemory<T extends SearchDoc>(query: string, docs: T[], limit = 10): { results: SearchHit<T>[]; broad: string | null } {
  const run = (q: string) => {
    const pq = parseQuery(q);
    const hits: { doc: T; rank: number }[] = [];
    for (const doc of docs) {
      const rank = score(pq, doc);
      if (rank !== null) hits.push({ doc, rank });
    }
    hits.sort((a, b) => b.rank - a.rank || time(b.doc.updated_at) - time(a.doc.updated_at));
    return hits.slice(0, Math.max(1, limit)).map((h) => ({ ...h, snippet: snippet(pq, h.doc.body) }));
  };
  const strict = run(query);
  if (strict.length) return { results: strict, broad: null };
  const broad = broadenQuery(query);
  return broad ? { results: run(broad), broad } : { results: [], broad: null };
}

const time = (d: Date | string) => new Date(d).getTime();

const MAX_WORDS = 24, FRAGMENTS = 2, LEAD = 4;

/** Like ts_headline(MaxWords=24, MaxFragments=2, StartSel=«, StopSel=»): up to two stretches of the
 *  text around matches, the matches marked, joined with " ... ". */
export function snippet(q: ParsedQuery, body: string): string {
  const tokens = [...body.matchAll(WORD)].map((m) => ({ w: m[0].toLowerCase(), s: m.index!, e: m.index! + m[0].length }));
  if (!tokens.length) return body.trim().slice(0, 200);
  const marks: [number, number][] = [];
  for (const t of q.groups.flat()) {
    for (let i = 0; i + t.length <= tokens.length; i++) {
      if (t.every((w, k) => tokens[i + k].w === w)) marks.push([tokens[i].s, tokens[i + t.length - 1].e]);
    }
  }
  // The query as typed, where it appears as-is (inside a word, or with its punctuation).
  if (q.raw) {
    const lower = body.toLowerCase(), raw = q.raw.toLowerCase();
    for (let at = lower.indexOf(raw), n = 0; at >= 0 && n < 50; at = lower.indexOf(raw, at + raw.length), n++) marks.push([at, at + raw.length]);
  }
  marks.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const m of marks) {
    const last = merged[merged.length - 1];
    if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]); else merged.push([...m]);
  }
  const windows: [number, number][] = []; // token index ranges [from, to)
  for (const [s] of merged) {
    if (windows.length >= FRAGMENTS) break;
    let at = tokens.findIndex((t) => t.e > s);
    if (at < 0) at = tokens.length - 1;
    if (windows.some(([a, b]) => at >= a && at < b)) continue;
    const from = Math.max(0, at - LEAD, windows.length ? windows[windows.length - 1][1] : 0);
    windows.push([from, Math.min(tokens.length, from + MAX_WORDS)]);
  }
  if (!windows.length) windows.push([0, Math.min(tokens.length, MAX_WORDS)]);
  return windows.map(([a, b]) => {
    const start = Math.min(tokens[a].s, ...merged.filter(([s, e]) => s < tokens[a].s && e > tokens[a].s).map(([s]) => s));
    let end = tokens[b - 1].e;
    for (const [s, e] of merged) if (s < end && e > end) end = e;
    let out = "", pos = start;
    for (const [s, e] of merged) {
      if (e <= start || s >= end) continue;
      out += body.slice(pos, s) + "«" + body.slice(s, e) + "»";
      pos = e;
    }
    return (out + body.slice(pos, end)).replace(/\s+/g, " ").trim();
  }).join(" ... ");
}

// MARK: File types

const UTI: Record<string, string> = {
  "public.plain-text": "text/plain", "public.utf8-plain-text": "text/plain", "public.text": "text/plain",
  "public.comma-separated-values-text": "text/csv", "public.tab-separated-values-text": "text/tab-separated-values",
  "public.json": "application/json", "public.xml": "application/xml", "public.html": "text/html",
  "net.daringfireball.markdown": "text/markdown", "public.rtf": "application/rtf",
  "public.png": "image/png", "public.jpeg": "image/jpeg", "com.compuserve.gif": "image/gif", "org.webmproject.webp": "image/webp",
  "public.heic": "image/heic", "public.heif": "image/heif", "public.tiff": "image/tiff", "public.svg-image": "image/svg+xml",
  "com.adobe.pdf": "application/pdf", "public.zip-archive": "application/zip",
  "org.openxmlformats.spreadsheetml.sheet": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "org.openxmlformats.wordprocessingml.document": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "org.openxmlformats.presentationml.presentation": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "com.microsoft.excel.xls": "application/vnd.ms-excel", "com.microsoft.word.doc": "application/msword",
  "com.apple.quicktime-movie": "video/quicktime", "public.mpeg-4": "video/mp4", "public.mp3": "audio/mpeg", "public.mpeg-4-audio": "audio/mp4",
};

const EXTENSIONS: Record<string, string> = {
  txt: "text/plain", text: "text/plain", log: "text/plain", csv: "text/csv", tsv: "text/tab-separated-values", json: "application/json",
  xml: "application/xml", html: "text/html", htm: "text/html", md: "text/markdown", markdown: "text/markdown", rtf: "application/rtf",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", heic: "image/heic", heif: "image/heif",
  tif: "image/tiff", tiff: "image/tiff", svg: "image/svg+xml", pdf: "application/pdf", zip: "application/zip",
  xlsx: UTI["org.openxmlformats.spreadsheetml.sheet"], docx: UTI["org.openxmlformats.wordprocessingml.document"],
  pptx: UTI["org.openxmlformats.presentationml.presentation"], xls: "application/vnd.ms-excel", doc: "application/msword",
  mov: "video/quicktime", mp4: "video/mp4", mp3: "audio/mpeg", m4a: "audio/mp4",
};

/** A MIME type for a file's stored type (a UTType identifier from the apps, or already a MIME
 *  type), falling back on its name's extension. */
export function mimeOf(type: string, name: string): string {
  const t = type.trim().toLowerCase();
  if (/^[a-z]+\/[a-z0-9.+-]+$/.test(t)) return t;
  if (UTI[t]) return UTI[t];
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return (ext && EXTENSIONS[ext]) || "application/octet-stream";
}

/** Types whose bytes are text a model reads as it is. */
export function isTextType(mime: string): boolean {
  return mime.startsWith("text/") || ["application/json", "application/xml", "application/csv"].includes(mime) ||
    mime.endsWith("+json") || mime.endsWith("+xml");
}
