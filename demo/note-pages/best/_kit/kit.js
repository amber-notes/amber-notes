// The shared helpers of the best-apps set. Everything here reads the note through amber.note and
// changes it only through amber.update; the app's own state goes through amber.store.
const Kit = (() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // Type follows the system: on the iPhone the body size follows Dynamic Type; the Mac is denser.
  (function baseSize() {
    const apply = () => {
      const body = parseFloat(getComputedStyle(document.body).fontSize) || 17;
      let size = body;
      if (body >= 16) {
        const p = document.createElement("span");
        p.style.font = "-apple-system-body";
        document.body.appendChild(p);
        const dyn = parseFloat(getComputedStyle(p).fontSize);
        p.remove();
        if (p.style.font && dyn >= 14 && dyn <= 40) size = dyn;
      }
      document.documentElement.style.fontSize = size + "px";
    };
    if (document.body) apply(); else addEventListener("DOMContentLoaded", apply);
  })();

  // Icons: inline SVG, drawn on a 24 grid with a 2 px stroke, like SF Symbols' regular weight.
  const paths = {
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    flame: '<path d="M12 2c1 3.5 5 6 5 11a5 5 0 0 1-10 0c0-2.5 1.2-4 2.5-5.5C10 10 11 11 11.5 12c.5-3 .5-6.5.5-10z"/>',
    chevron: '<path d="M9 5l7 7-7 7"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    cart: '<path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/><circle cx="10" cy="20.5" r="1.3"/><circle cx="17" cy="20.5" r="1.3"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2h5"/>',
    play: '<path d="M7 4.5v15l12.5-7.5z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v16H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>',
    quote: '<path d="M7 11h4v6H5v-4a6 6 0 0 1 4-5.7M17 11h4v6h-6v-4a6 6 0 0 1 4-5.7"/>',
    pin: '<path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    gift: '<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v8h14v-8M12 8v13M12 8S10.5 3 8 3.5 7 8 12 8zm0 0s1.5-5 4-4.5S17 8 12 8z"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M4 17v3h16v-3"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
    repeat: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    cloud: '<path d="M7 18a4.5 4.5 0 1 1 .9-8.9A6 6 0 0 1 19.5 11 3.5 3.5 0 0 1 18 18z"/>',
    rain: '<path d="M7 15a4.5 4.5 0 1 1 .9-8.9A6 6 0 0 1 19.5 8 3.5 3.5 0 0 1 18 15z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
    suitcase: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V4.5h6V7M3 12h18"/>',
    coins: '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M9 15v2c0 1.7 2.7 3 6 3s6-1.3 6-3v-5c0-1.7-2.7-3-6-3"/>',
    knife: '<path d="M4 20L18 6a2.8 2.8 0 0 1 2 4L9 21z"/>',
    pot: '<path d="M4 10h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM2 10h20M9 6c0-1.5 1-2 1-3M14 6c0-1.5 1-2 1-3"/>',
    cards: '<rect x="3" y="6" width="14" height="15" rx="2.5"/><path d="M7 3h11.5A2.5 2.5 0 0 1 21 5.5V18"/>',
    dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
    map: '<path d="M9 4L3 6.5v14L9 18l6 2.5 6-2.5V4l-6 2.5zM9 4v14M15 6.5v14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
    note: '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5"/>',
  };
  const ico = (n, extra = "") => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${paths[n] || ""}</svg>`;

  // Dates are "yyyy-mm-dd" strings from the note; the clock is amber.note.today.
  const D = {
    parse: (s) => { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(String(s || "").trim()); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; },
    iso: (d) => d.toISOString().slice(0, 10),
    add: (s, n) => { const d = D.parse(s); d.setUTCDate(d.getUTCDate() + n); return D.iso(d); },
    diff: (a, b) => Math.round((D.parse(a) - D.parse(b)) / 86400000),
    wd: (s) => (D.parse(s).getUTCDay() + 6) % 7, // 0 = Monday
    weekStart: (s) => D.add(s, -D.wd(s)),
    fmt: (s, o = { weekday: "short", day: "numeric", month: "short" }) => { const d = D.parse(s); return d ? d.toLocaleDateString("en-GB", { timeZone: "UTC", ...o }) : ""; },
    month: (s) => D.fmt(s, { month: "long" }),
    rel: (s, today) => { const n = D.diff(s, today); return n === 0 ? "Today" : n === 1 ? "Tomorrow" : n === -1 ? "Yesterday" : n > 1 && n < 7 ? D.fmt(s, { weekday: "long" }) : n > 0 ? `In ${n} days` : `${-n} days ago`; },
  };

  const num = (s) => { const n = parseFloat(String(s ?? "").replace(/\s| /g, "").replace(/kr|sek|€|\$/gi, "").replace(",", ".")); return Number.isFinite(n) ? n : NaN; };
  const kr = (n, o = {}) => new Intl.NumberFormat("sv-SE", { maximumFractionDigits: o.dec ?? 0, minimumFractionDigits: o.dec ?? 0 }).format(Math.round(n * 10 ** (o.dec ?? 0)) / 10 ** (o.dec ?? 0)) + (o.unit === false ? "" : " " + (o.unit || "kr"));
  const fmtN = (n, dec = 0) => new Intl.NumberFormat("sv-SE", { maximumFractionDigits: dec }).format(n);
  const done = (s) => /^(✓|✔|x|yes|done|1|true)$/i.test(String(s ?? "").trim());
  const col = (t, re) => t ? t.columns.findIndex((c) => re.test(c.name.trim())) : -1;
  const table = (note, ...res) => note.tables.find((t) => res.every((re) => col(t, re) >= 0));

  // Where each table sits in the markdown, so several rows can go in with one edit (one Undo).
  function tableLines(md) {
    const lines = md.split("\n"), out = [];
    const isRow = (l) => l.trim().startsWith("|");
    const isSep = (l) => { const t = l.trim(); return t.startsWith("|") && t.includes("-") && [...t].every((c) => "|-: ".includes(c)); };
    for (let i = 0; i < lines.length;) {
      if (!(isRow(lines[i]) && isSep(lines[i + 1] || ""))) { i++; continue; }
      let j = i + 2; while (j < lines.length && isRow(lines[j])) j++;
      out.push({ start: i, end: j }); i = j;
    }
    return { lines, tables: out };
  }
  const level = (l) => { const m = /^(#{1,6}) /.exec(l); return m ? m[1].length : 0; };
  const cellText = (v) => String(v ?? "").replace(/\n/g, " ").replace(/\|/g, "\\|");
  /** Adds rows to table `index` in one edit: the section around the table is rewritten with set_text. */
  async function addRows(index, rows, columns) {
    const note = amber.note, t = note.tables[index];
    const asCells = rows.map((r) => Array.isArray(r) ? r : (columns || t.columns.map((c) => c.name)).map((n) => r[n] ?? ""));
    const { lines, tables } = tableLines(note.markdown);
    const at = tables[index];
    let h = -1; for (let k = at.start - 1; k >= 0; k--) if (level(lines[k])) { h = k; break; }
    if (h < 0 || rows.length === 1) {
      for (const r of asCells) { const res = await amber.update({ op: "append_row", table: index, values: r }); if (!res.ok) return res; }
      return { ok: true };
    }
    const lv = level(lines[h]); let end = h + 1; while (end < lines.length && !(level(lines[end]) && level(lines[end]) <= lv)) end++;
    const section = [...lines.slice(h + 1, at.end), ...asCells.map((c) => "| " + c.map(cellText).join(" | ") + " |"), ...lines.slice(at.end, end)];
    return amber.update({ op: "set_text", heading: lines[h].replace(/^#+\s*/, ""), text: section.join("\n") });
  }

  // A sheet: one at a time, Escape or the scrim closes it, focus goes in and comes back.
  let current = null;
  function sheet(title, html, { mount, wide, actions = "" } = {}) {
    close();
    const back = document.activeElement;
    const host = document.createElement("div");
    host.className = "sheet-host";
    host.innerHTML = `<div class="scrim" data-close></div><section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}" ${wide ? 'style="width:min(46rem,94vw)"' : ""}>
      <div class="grab"></div><header><h2>${esc(title)}</h2>${actions}<button class="round" data-close aria-label="Close">${ico("close")}</button></header><div class="sheet-body">${html}</div></section>`;
    document.body.appendChild(host);
    const onKey = (e) => { if (e.key === "Escape") close(); };
    host.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) close(); });
    addEventListener("keydown", onKey);
    current = { host, back, onKey };
    requestAnimationFrame(() => requestAnimationFrame(() => host.classList.add("open")));
    mount && mount(host.querySelector(".sheet-body"), close);
    setTimeout(() => (host.querySelector("[autofocus]") || host.querySelector(".sheet header .round")).focus({ preventScroll: true }), 60);
    return close;
  }
  function close() {
    if (!current) return;
    const { host, back, onKey } = current;
    current = null;
    removeEventListener("keydown", onKey);
    host.classList.remove("open");
    setTimeout(() => host.remove(), 380);
    back && back.focus && back.focus({ preventScroll: true });
  }

  // App settings: declared once with defaults, changed in a sheet without asking an AI. Kept in the
  // app's own data under "settings" (amber.settings when the app offers it).
  function settings(schema) {
    const get = () => {
      const saved = (amber.settings && amber.settings.values) || (amber.data.values.settings || {});
      return Object.fromEntries(schema.map((f) => [f.key, saved[f.key] ?? f.default]));
    };
    const save = (key, value) => amber.settings && amber.settings.set ? amber.settings.set(key, value) : amber.setData({ values: { settings: { [key]: value } } });
    function open(title = "Settings", extra = "") {
      const s = get();
      const field = (f) => {
        const id = "set-" + f.key;
        if (f.type === "toggle") return `<label class="row" for="${id}"><span class="grow">${esc(f.label)}${f.help ? `<div class="muted small">${esc(f.help)}</div>` : ""}</span><input class="switch" type="checkbox" id="${id}" data-key="${f.key}" ${s[f.key] ? "checked" : ""}></label>`;
        const input = f.type === "select"
          ? `<select class="in" id="${id}" data-key="${f.key}">${f.options.map((o) => `<option value="${esc(o[0])}" ${String(s[f.key]) === String(o[0]) ? "selected" : ""}>${esc(o[1])}</option>`).join("")}</select>`
          : `<input class="in num" id="${id}" data-key="${f.key}" type="${f.type === "number" ? "number" : f.type === "time" ? "time" : "text"}" ${f.type === "number" ? `inputmode="decimal" step="${f.step || 1}" min="${f.min ?? 0}"` : ""} value="${esc(s[f.key])}">`;
        return `<div class="row stack"><label for="${id}" class="grow">${esc(f.label)}${f.unit ? ` <span class="muted">(${esc(f.unit)})</span>` : ""}${f.help ? `<div class="muted small">${esc(f.help)}</div>` : ""}</label><div class="set-input">${input}</div></div>`;
      };
      sheet(title, `<div class="card list settings-list">${schema.map(field).join("")}</div>${extra}<p class="muted small" style="margin:.9rem .3rem 0">Settings are kept in this note's app, on all your devices.</p>`, {
        mount(root) {
          root.addEventListener("change", (e) => {
            const el = e.target.closest("[data-key]"); if (!el) return;
            const f = schema.find((x) => x.key === el.dataset.key);
            const v = f.type === "toggle" ? el.checked : f.type === "number" ? (Number.isFinite(parseFloat(el.value)) ? parseFloat(el.value) : f.default) : el.value;
            save(f.key, v);
          });
        },
      });
    }
    return { get, open, save };
  }

  const style = document.createElement("style");
  style.textContent = `.settings-list .row.stack { flex-wrap: wrap; } .settings-list .set-input { width: 9.5rem; } .settings-list .set-input .in { text-align: right; } .settings-list label.row { cursor: pointer; }
  @media (max-width: 420px) { .settings-list .set-input { width: 8rem; } }`;
  document.head.appendChild(style);

  // Charts drawn at their real width (so 10 px labels stay 10 px): width(key) is the last measured
  // width of the element with data-w="key"; fit(render) re-renders once when a width changed.
  const widths = {};
  const width = (key, fallback) => widths[key] || fallback;
  function fit(render) {
    let changed = false;
    for (const el of document.querySelectorAll("[data-w]")) {
      const cs = getComputedStyle(el);
      const w = Math.round(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
      if (w && Math.abs((widths[el.dataset.w] || 0) - w) > 4) { widths[el.dataset.w] = w; changed = true; }
    }
    if (changed) render();
  }
  let resizeT;
  const onResize = (render) => addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => { for (const k in widths) delete widths[k]; render(); fit(render); }, 120); });

  const once = (fn) => { let p; return () => p || (p = fn()); };
  const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  const announce = (() => { let el; return (msg) => { if (!el) { el = document.createElement("div"); el.className = "sr"; el.setAttribute("aria-live", "polite"); document.body.appendChild(el); } el.textContent = ""; setTimeout(() => (el.textContent = msg), 30); }; })();

  return { width, fit, onResize, esc, $, $$, ico, D, num, kr, fmtN, done, col, table, addRows, sheet, close, settings, once, hash, announce };
})();
