// Note page widgets (prototype): a home-screen widget for a note's page. WidgetKit can't run the
// page's HTML, so the widget is a small JSON spec built from fixed native blocks whose values bind
// to the note's tables and checklists. The app works the values out and draws them; the spec holds
// no data. The check is pure, so it's unit-tested; the app's own reader (NoteWidget.parse) has the
// same limits. People never hear "page": to them it's the note's app.

export const MAX_WIDGET_BYTES = 8 * 1024;
export const MAX_BLOCKS = 8;
export const MAX_BUTTONS = 2;
const FACES = ["small", "medium", "large", "circular", "rectangular"] as const;
const BLOCKS = ["title", "text", "number", "ring", "bar", "list", "chart", "grid", "button", "row"];
const BINDINGS = ["streak", "done_today", "done_days", "done_count_today", "habits", "rows", "sum", "latest", "checked", "unchecked", "title"];
const OPS = ["toggle_today", "toggle_checklist"];

/** What a widget can hold. The same words go to the AI in set_note_widget's description. */
export const WIDGET_CONTRACT = `A widget is JSON: { small?: [block], medium?: [block], large?: [block], circular?: [block], rectangular?: [block] } (circular and rectangular are the iPhone Lock Screen; give at least small).
At most ${MAX_BLOCKS} blocks per size. Blocks, each { type, ... }:
  title { text, sub? }    text { text }    number { value, label? }
  ring { value, max, center?, label? }    bar { value, max, label? }
  list { checklist: true, limit? } | { items: [value] } | { table, column, last? }
  chart { series, kind: "bar" | "line" }    grid { table, columns?, days? }  (a habit grid: one row per column, ✓ cells filled)
  button { label, op }    row { blocks: [block] }  (up to 3 side by side)
A value is text, a number, a list of values (joined into one text), or one binding over the note:
  { streak: { table, column } }  days in a row the column is done (✓, x, yes, done), back from today, or from yesterday while today is open
  { done_today: { table, column } }  { done_days: { table, column, days } }  { done_count_today: { table } }  { habits: { table } }
  { rows: { table } }  { sum: { table, column, days?, month?: true } }  { latest: { table, column } }  { checked: {} }  { unchecked: {} }  { title: {} }
Tables count from 0, as in read_note; dates come from the table's Date column (yyyy-mm-dd).
A series: { table, column, days, agg: "sum" | "done" } (one value per day) or { table, column, last } (one per row).
Buttons (at most ${MAX_BUTTONS} different ones) change the note, as a page's edits do: { op: "toggle_today", table, column, value? } ticks today's cell (adding today's row if needed), { op: "toggle_checklist", text } ticks a checklist item.
Keep it glanceable: a small widget is about 160 points square; one big figure, a ring or a short list, and at most one button.`;

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Why a widget can't be stored, or an empty list when it can. */
export function widgetProblems(spec: unknown): string[] {
  const out: string[] = [];
  const text = typeof spec === "string" ? spec : JSON.stringify(spec);
  const bytes = new TextEncoder().encode(text ?? "").length;
  if (bytes > MAX_WIDGET_BYTES) return [`The widget is ${Math.ceil(bytes / 1024)} KB; the limit is ${MAX_WIDGET_BYTES / 1024} KB.`];
  let w: Json;
  try { w = typeof spec === "string" ? JSON.parse(spec) : spec as Json; } catch { return ["The widget isn't valid JSON."]; }
  if (!w || typeof w !== "object" || Array.isArray(w)) return ["A widget is a JSON object with sizes as keys."];
  const faces = FACES.filter((f) => f in w);
  if (!faces.length) return [`Give at least one size: ${FACES.join(", ")}.`];
  const extra = Object.keys(w).filter((k) => !(FACES as readonly string[]).includes(k));
  if (extra.length) out.push(`Unknown keys: ${extra.join(", ")}. Sizes are ${FACES.join(", ")}.`);
  const ops = new Set<string>();

  const value = (v: Json | undefined, where: string) => {
    if (v === undefined || v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return;
    if (Array.isArray(v)) { v.forEach((x) => value(x, where)); return; }
    const keys = Object.keys(v);
    if (keys.length !== 1 || !BINDINGS.includes(keys[0])) out.push(`${where}: a binding is one of ${BINDINGS.join(", ")}, got {${keys.join(", ")}}.`);
  };
  const block = (b: Json, where: string, depth: number) => {
    if (!b || typeof b !== "object" || Array.isArray(b)) { out.push(`${where}: a block is an object.`); return; }
    const type = b.type;
    if (typeof type !== "string" || !BLOCKS.includes(type)) { out.push(`${where}: unknown block type ${JSON.stringify(type)}. Types: ${BLOCKS.join(", ")}.`); return; }
    for (const k of ["text", "sub", "value", "max", "center", "label"]) value(b[k], `${where}.${k}`);
    if (type === "button") {
      const op = b.op;
      if (!op || typeof op !== "object" || Array.isArray(op) || !OPS.includes(op.op as string)) out.push(`${where}: a button's op is ${OPS.join(" or ")}.`);
      else {
        if (op.op === "toggle_today" && (typeof op.table !== "number" || typeof op.column !== "string")) out.push(`${where}: toggle_today needs table (a number) and column (a name).`);
        if (op.op === "toggle_checklist" && typeof op.text !== "string") out.push(`${where}: toggle_checklist needs the item's text.`);
        ops.add(JSON.stringify(op, Object.keys(op).sort()));
      }
    }
    if (type === "row") {
      if (depth > 0) out.push(`${where}: rows don't nest.`);
      const inner = Array.isArray(b.blocks) ? b.blocks : [];
      if (!inner.length || inner.length > 3) out.push(`${where}: a row holds 1 to 3 blocks.`);
      inner.forEach((x, i) => block(x, `${where}.blocks[${i}]`, depth + 1));
    }
    if ((type === "grid" || type === "chart") && b.days !== undefined && (typeof b.days !== "number" || b.days < 1 || b.days > 31)) out.push(`${where}: days is 1 to 31.`);
  };
  for (const f of faces) {
    const blocks = w[f];
    if (!Array.isArray(blocks)) { out.push(`${f} is a list of blocks.`); continue; }
    if (blocks.length > MAX_BLOCKS) out.push(`${f} has ${blocks.length} blocks; at most ${MAX_BLOCKS}.`);
    blocks.forEach((b, i) => block(b, `${f}[${i}]`, 0));
  }
  if (ops.size > MAX_BUTTONS) out.push(`A widget has at most ${MAX_BUTTONS} different buttons; this one has ${ops.size}.`);
  return out;
}
