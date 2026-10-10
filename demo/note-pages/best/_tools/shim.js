// A stand-in for Amber Notes' page bridge, for the lab: the note's tables and checklists, the ops
// (batched as one change), the app's own data, and device calls answered with stand-ins.
(() => {
  const lab = window.__amberLab || {};
  let body = lab.body || "", data = lab.data || { values: {}, collections: {} };
  const log = (window.__amberLog = []);
  const cells = (l) => { let t = l.trim().replace(/^\|/, ""); if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1); return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|")); };
  const isRow = (l) => l.trim().startsWith("|"), isSep = (l) => isRow(l) && l.includes("-") && [...l.trim()].every((c) => "|-: ".includes(c));
  function tables(lines) {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      if (!(isRow(lines[i]) && isSep(lines[i + 1] || ""))) continue;
      const header = cells(lines[i]), rows = [], rowLines = []; let j = i + 2;
      while (j < lines.length && isRow(lines[j])) { const c = cells(lines[j]); while (c.length < header.length) c.push(""); rows.push(c.slice(0, header.length)); rowLines.push(j); j++; }
      out.push({ start: i, columns: header.map((n) => ({ name: n, type: "text" })), rows, rowLines, end: j }); i = j - 1;
    }
    return out;
  }
  const check = /^(\s*)([-*+]|\d+[.)])\s\[( |x|X)\]\s/;
  const note = () => { const lines = body.split("\n"); return { title: (lines.find((l) => l.trim()) || "").replace(/^#+\s*/, "").trim(), markdown: body, today: lab.today,
    tables: tables(lines).map((t, i) => ({ index: i, columns: t.columns, rows: t.rows })),
    checklists: lines.map((l, i) => { const m = l.match(check); return m ? { line: i + 1, text: l.slice(m[0].length), checked: m[3] !== " " } : null; }).filter(Boolean) }; };
  const rowLine = (c) => "| " + c.map((x) => String(x).replace(/\|/g, "\\|")).join(" | ") + " |";
  const lvl = (l) => { const m = /^(#{1,6}) /.exec(l); return m ? m[1].length : 0; };
  function apply(op) {
    if (Array.isArray(op)) { const b = body; try { op.forEach(apply); } catch (e) { body = b; throw e; } return; }
    const lines = body.split("\n"), T = (i) => { const t = tables(lines)[i]; if (!t) throw new Error(`Table ${i} doesn't exist.`); return t; };
    const col = (t, c) => { const i = typeof c === "number" ? c : t.columns.findIndex((x) => x.name.toLowerCase() === String(c).toLowerCase()); if (i < 0 || i >= t.columns.length) throw new Error(`No column ${c}.`); return i; };
    switch (op.op) {
      case "append_row": { const t = T(op.table), c = t.columns.map(() => ""); if (Array.isArray(op.values)) op.values.forEach((v, i) => (c[i] = String(v))); else for (const [k, v] of Object.entries(op.values)) c[col(t, k)] = String(v); lines.splice(t.end, 0, rowLine(c)); break; }
      case "set_cell": { const t = T(op.table), c = t.rows[op.row].slice(); c[col(t, op.col)] = String(op.value); lines[t.rowLines[op.row]] = rowLine(c); break; }
      case "delete_row": { const t = T(op.table); lines.splice(t.rowLines[op.row], 1); break; }
      case "move_row": { const t = T(op.table); const [l] = lines.splice(t.rowLines[op.from], 1); lines.splice(t.rowLines[op.to], 0, l); break; }
      case "toggle_checklist": { const i = op.line - 1; lines[i] = lines[i].replace(/\[( |x|X)\]/, (m) => (m === "[ ]" ? "[x]" : "[ ]")); break; }
      case "add_checklist_item": { let at = lines.length; if (op.under_heading) { const h = lines.findIndex((l) => lvl(l) && l.replace(/^#+\s*/, "").toLowerCase() === op.under_heading.toLowerCase()); at = h + 1; while (at < lines.length && !lvl(lines[at])) at++; while (at > h + 1 && !lines[at - 1].trim()) at--; } lines.splice(at, 0, "- [ ] " + op.text); break; }
      case "set_text": { const h = lines.findIndex((l) => lvl(l) && l.replace(/^#+\s*/, "").toLowerCase() === op.heading.toLowerCase()); if (h < 0) throw new Error(`No heading ${op.heading}.`); let e = h + 1; while (e < lines.length && !(lvl(lines[e]) && lvl(lines[e]) <= lvl(lines[h]))) e++; lines.splice(h + 1, e - h - 1, ...op.text.split("\n")); break; }
      case "add_column": { const t = T(op.table); for (let k = t.start; k < t.end; k++) { const c = cells(lines[k]); c.push(k === t.start ? op.name : k === t.start + 1 ? "---" : ""); lines[k] = rowLine(c); } break; }
      default: throw new Error(`Unknown op ${op.op}.`);
    }
    body = lines.join("\n");
  }
  const merge = (t, p) => { const o = { ...(t && typeof t === "object" && !Array.isArray(t) ? t : {}) }; for (const [k, v] of Object.entries(p)) { if (v === null) delete o[k]; else if (v && typeof v === "object" && !Array.isArray(v)) o[k] = merge(o[k], v); else o[k] = v; } return o; };
  const clone = (x) => JSON.parse(JSON.stringify(x)), listeners = [];
  const changed = () => setTimeout(() => amber._receive(note(), clone(data)), 0);
  let n = 0;
  async function dataOp(m) {
    if (m.op.startsWith("device.")) { log.push({ device: m.op.slice(7) }); return { ok: true, id: "n" + ++n, contact: null, files: [] }; }
    if (m.op === "fetch") return { ok: false, error: "No network in the lab." };
    const d = clone(data), stamp = new Date().toISOString(); let made;
    if (m.op === "store.set") { if (m.value === null) delete d.values[m.key]; else d.values[m.key] = m.value; }
    else if (m.op === "store.patch") { const r = merge(d, m.patch); d.values = r.values || {}; d.collections = r.collections || {}; }
    else if (m.op === "collection.add") { const l = d.collections[m.name] || []; made = m.fields.id || "r" + ++n; l.push({ ...m.fields, id: made, created: stamp, updated: stamp }); d.collections[m.name] = l; }
    else if (m.op === "collection.update") { const l = d.collections[m.name] || [], i = l.findIndex((r) => r.id === m.id); l[i] = { ...merge(l[i], m.patch), id: m.id }; }
    else if (m.op === "collection.remove") { d.collections[m.name] = (d.collections[m.name] || []).filter((r) => r.id !== m.id); }
    data = d; log.push({ data: m.op, key: m.key || m.name }); changed();
    return { ok: true, data: clone(d), ...(made ? { id: made } : {}) };
  }
  const ask = (m) => dataOp(m).then((r) => { if (r.data) amber.data = r.data; delete r.data; return r; });
  const amber = {
    note: note(), data: clone(data),
    update(op) { try { apply(op); } catch (e) { log.push({ refused: op, error: e.message }); return Promise.resolve({ ok: false, error: e.message }); } log.push({ update: op }); changed(); return Promise.resolve({ ok: true }); },
    onChange(fn) { listeners.push(fn); fn(amber.note, amber.data); },
    setData: (patch) => ask({ op: "store.patch", patch }),
    store: { get: (k) => Promise.resolve(amber.data.values[k]), set: (k, v) => ask({ op: "store.set", key: k, value: v === undefined ? null : v }),
      collection: (name) => ({ list: () => Promise.resolve((amber.data.collections[name] || []).slice()), add: (f) => ask({ op: "collection.add", name, fields: f }), update: (id, p) => ask({ op: "collection.update", name, id, patch: p }), remove: (id) => ask({ op: "collection.remove", name, id }) }) },
    files: { save: () => Promise.resolve({ ok: false }), read: () => Promise.resolve({ ok: false }), url: () => "" },
    device: { notify: Object.assign((x) => ask({ op: "device.notify", ...x }), { cancel: (id) => ask({ op: "device.notify.cancel", id }) }),
      reminders: { create: (x) => ask({ op: "device.reminders.create", ...x }), delete: (id) => ask({ op: "device.reminders.delete", id }), complete: (id) => ask({ op: "device.reminders.complete", id }) },
      openURL: (u) => ask({ op: "device.openURL", url: u }), share: (f) => ask({ op: "device.share", name: f && f.name }), maps: { snapshot: () => Promise.resolve({ ok: false }), open: () => Promise.resolve({ ok: true }) }, contacts: { pick: () => ask({ op: "device.contacts.pick" }) } },
    ai: { available: () => Promise.resolve({ ok: true, available: false, reason: "not in the lab" }), respond: () => Promise.resolve({ ok: false, error: "No AI in the lab." }) },
    fetch: (u) => ask({ op: "fetch", url: u }), insets: { bottom: 0 },
    // Inside batch(), every change is still applied at once here; the host sends them as one Undo.
    batch: async (fn) => { log.push({ batch: "start" }); try { return await fn(); } finally { log.push({ batch: "end" }); } },
    setSummary: (t) => { log.push({ summary: String(t) }); window.__amberSummary = String(t); return Promise.resolve({ ok: true }); },
  };
  Object.defineProperty(amber, "_receive", { value(nt, d) { amber.note = nt; if (d) amber.data = d; listeners.forEach((f) => f(nt, amber.data)); } });
  Object.defineProperty(amber, "_body", { get: () => body });
  window.amber = amber;
})();
