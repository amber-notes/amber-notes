// A note and app data with the same shape as the person's but none of their content, for
// check_app and preview_app: the app is rendered (by a separate render service) over this, so the
// person's notes don't leave the MCP server for a picture. Pure, so it's unit-tested.

import { findTables } from "./notes.ts";

/** A small deterministic number from a string, so a sample looks the same every time. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

const TICK = /^[\s✓✔xX·•\-–—*]*$|^(yes|no|done|true|false|y|n)$/i;
const DATE = /^\d{4}-\d{2}-\d{2}/;
const NUM = /^[-+]?[\d\s ]*[\d][.,]?\d*\s*(%|kr|sek|\$|€|£|km|kg|min|h)?$/i;

/** One cell or value with its shape kept: dates stay dates, numbers stay numbers of the same size,
 *  ticks and empties stay as they are, text becomes a label that keeps repeats repeated. */
function fake(v: string, labels: Map<string, string>, prefix: string, today: string): string {
  const t = v.trim();
  if (!t || TICK.test(t)) return v;
  if (DATE.test(t)) {
    // Same distance from today's month, a different day of it.
    const day = 1 + Math.floor(hash(t) * 27);
    return t.slice(0, 8).replace(/^\d{4}-\d{2}-/, (m) => m) + String(day).padStart(2, "0") + t.slice(10);
  }
  if (NUM.test(t)) {
    const digits = t.replace(/[^\d]/g, "").length || 1;
    const n = Math.max(1, Math.round(hash(t) * 10 ** digits));
    return t.replace(/[\d][\d\s ]*([.,]\d+)?/, String(n).slice(0, digits) + (/[.,]\d/.test(t) ? t.match(/[.,]\d+/)![0].replace(/\d/g, "5") : ""));
  }
  if (!labels.has(t)) labels.set(t, `${prefix} ${labels.size + 1}`);
  return labels.get(t)!;
}

/** The note's markdown, every word replaced, its tables, checklists and headings kept in shape. */
export function sampleNote(markdown: string, today: string): string {
  const lines = markdown.split("\n");
  const inTable = new Set<number>();
  const tables = findTables(markdown);
  const labels = new Map<string, string>();
  for (const t of tables) for (let k = t.start; k <= t.end; k++) inTable.add(k);
  let titled = false, heading = 0, item = 0, para = 0;
  return lines.map((l, k) => {
    if (inTable.has(k)) {
      if (l.includes("pane-table:") || /^[\s|:-]+$/.test(l)) return l;
      const t = tables.find((x) => k >= x.start && k <= x.end)!;
      const headerAt = t.typed ? t.start + 1 : t.start;
      if (k === headerAt) return l; // column names are the shape the app reads
      const cells = l.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim());
      return "| " + cells.map((c, i) => fake(c, labels, t.columns[i]?.name ?? "Item", today)).join(" | ") + " |";
    }
    if (!l.trim()) return l;
    if (!titled) { titled = true; return l.match(/^#+\s/) ? l.replace(/^(#+\s).*/, "$1Sample note") : "Sample note"; }
    const h = l.match(/^(#{1,6}\s+)/);
    if (h) return `${h[1]}Section ${++heading}`;
    const c = l.match(/^(\s*[-*+]\s+\[[ xX]\]\s+)/);
    if (c) return `${c[1]}Item ${++item}`;
    const b = l.match(/^(\s*(?:[-*+]|\d+[.)])\s+)/);
    if (b) return `${b[1]}Point ${++item}`;
    if (/^\s*<!--/.test(l)) return l;
    // "Label: value" lines keep their label's shape, which apps often read.
    const kv = l.match(/^(\s*\**[\p{L} ]{2,24}?\**\s*:\s+)(.+)$/u);
    if (kv) return `${kv[1]}${fake(kv[2], labels, "Value", today)}`;
    return `Sample text ${++para}.`;
  }).join("\n");
}

/** The app's data with every value replaced the same way; keys, nesting, ids, dates and file refs kept. */
export function sampleData(data: unknown, today: string, depth = 0, labels = new Map<string, string>()): unknown {
  if (depth > 12) return null;
  if (Array.isArray(data)) return data.slice(0, 50).map((v) => sampleData(v, today, depth + 1, labels));
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (typeof o.$file === "string") return { $file: "00000000-0000-4000-8000-000000000000", name: "sample.png", type: "image/png" };
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === "id" || k === "created" || k === "updated" ? v : sampleData(v, today, depth + 1, labels)]));
  }
  if (typeof data === "number") return Math.round(hash(String(data)) * Math.max(10, Math.abs(data) * 2) * 100) / 100;
  if (typeof data === "string") return fake(data, labels, "Sample", today);
  return data;
}
