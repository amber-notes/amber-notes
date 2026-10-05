// amber 1.0.0 (Amber Notes): the note and the app's own data as Preact hooks.
//   import { useNote, useTable, useChecklist, useAppData, useSettings, batch } from "amber";
// Tables and checklists are found by the heading above them (or a table by a column name), never
// by position. Changes go through the same note ops as window.amber.update, so each one is an
// edit you can Undo; batch(() => { ... }) makes several one change with one Undo.
import { useState, useLayoutEffect, useMemo } from "preact/hooks";

const bridge = window.amber;
export { bridge as amber };
export const device = bridge.device, ai = bridge.ai, files = bridge.files;
export const fetch = (url, options) => bridge.fetch(url, options);

// Changes made inside batch() are collected and sent as one.
let pending = null;
function send(op) {
  if (pending) { pending.push(op); return Promise.resolve({ ok: true }); }
  return bridge.update(op);
}
export async function batch(fn) {
  if (pending) return fn();
  pending = [];
  try { await fn(); } finally { const ops = pending; pending = null; if (ops.length) return bridge.update(ops); }
  return { ok: true };
}

// Re-render with the note and the app's data as they change. (A layout effect: a hidden app may
// never draw the frame a plain effect waits for.)
function useLive() {
  const [state, set] = useState({ note: bridge.note, data: bridge.data });
  useLayoutEffect(() => bridge.onChange((note, data) => set({ note, data: data || bridge.data })), []);
  return state;
}

/** The note: { title, markdown, today, tables, checklists }, live. */
export function useNote() { return useLive().note; }

const norm = (s) => String(s || "").trim().toLowerCase();
function findTable(note, name) {
  if (name == null) return note.tables[0];
  const n = norm(name);
  return note.tables.find((t) => norm(t.heading) === n) || note.tables.find((t) => t.columns.some((c) => norm(c.name) === n));
}

/**
 * A table by the heading above it ("Log") or one of its column names.
 * rows: [{ id, ...values by column name }]; add(values), update(id, patch), remove(id), move(id, to).
 * id is the row's position when you read it; use it in the same render.
 */
export function useTable(name) {
  const { note } = useLive();
  const t = findTable(note, name);
  return useMemo(() => {
    const index = () => { const now = findTable(bridge.note, name); if (!now) throw new Error(`No table "${name}" in the note.`); return now.index; };
    const rows = t ? t.rows.map((r, id) => Object.fromEntries([["id", id], ...t.columns.map((c, i) => [c.name, r[i] ?? ""])])) : [];
    return {
      found: !!t,
      columns: t ? t.columns.map((c) => c.name) : [],
      rows,
      add: (values) => send({ op: "append_row", table: index(), values }),
      update: (id, patch) => batch(() => { for (const [col, value] of Object.entries(patch)) send({ op: "set_cell", table: index(), row: id, col, value: String(value) }); }),
      remove: (id) => send({ op: "delete_row", table: index(), row: id }),
      move: (id, to) => send({ op: "move_row", table: index(), from: id, to }),
    };
  }, [t, name]);
}

/** A checklist by the heading above it: items [{ id, text, checked }], toggle(id), add(text), remove(id). */
export function useChecklist(name) {
  const { note } = useLive();
  return useMemo(() => {
    const items = note.checklists.filter((c) => name == null || norm(c.heading) === norm(name))
      .map((c) => ({ id: c.line, text: c.text, checked: c.checked }));
    return {
      items,
      toggle: (id) => send({ op: "toggle_checklist", line: id }),
      add: (text) => send({ op: "add_checklist_item", text, ...(name != null ? { under_heading: name } : {}) }),
      // The section without that line (the note's text is the truth: rewrite its section).
      remove: (id) => {
        const lines = bridge.note.markdown.split("\n");
        const start = lines.findIndex((l) => /^#{1,6}\s+/.test(l) && norm(l.replace(/^#{1,6}\s+/, "")) === norm(name));
        if (start < 0) return Promise.resolve({ ok: false, error: `No heading "${name}".` });
        let end = start + 1;
        while (end < lines.length && !/^#{1,6}\s+/.test(lines[end])) end++;
        const section = lines.slice(start + 1, end).filter((_, i) => start + 2 + i !== id);
        return send({ op: "set_text", heading: name, text: section.join("\n").replace(/^\n+|\n+$/g, "") });
      },
    };
  }, [note, name]);
}

/** Like useState, kept in the app's own data (encrypted, synced, never in the note's text). */
export function useAppData(key, initial) {
  const { data } = useLive();
  const values = (data && data.values) || {};
  const value = key in values ? values[key] : initial;
  const set = (next) => {
    const v = typeof next === "function" ? next(key in (bridge.data.values || {}) ? bridge.data.values[key] : initial) : next;
    return bridge.store.set(key, v);
  };
  return [value, set];
}

/** The app's settings with their defaults: [settings, update(patch)]. Kept like useAppData. */
export function useSettings(defaults = {}) {
  const [saved, set] = useAppData("settings", {});
  const settings = { ...defaults, ...(saved || {}) };
  return [settings, (patch) => set({ ...(saved || {}), ...patch })];
}
