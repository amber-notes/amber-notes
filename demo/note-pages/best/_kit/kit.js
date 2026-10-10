// The shared helpers of the best-apps set. Everything here reads the note through amber.note and
// changes it only through amber.update; the app's own state goes through amber.store.
const Kit = (() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

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
    chart: '<path d="M4 20V11M10 20V5M16 20v-6M21 20H3"/>',
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    wallet: '<rect x="3" y="6" width="18" height="14" rx="2.5"/><path d="M16 13h2M3 10h18M6 6l9-3 2 3"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a5 5 0 0 1 3.5 5.5"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4"/>',
    up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
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

  /** Adds rows to table `index` as one change (one Undo). */
  function addRows(index, rows) {
    return amber.update(rows.map((values) => ({ op: "append_row", table: index, values })));
  }

  // A sheet: one at a time, Escape or the scrim closes it, focus goes in and comes back. On the
  // phone it rises from the bottom and stays above the keyboard; from 700 px it's a centred panel.
  let current = null;
  function sheet(title, html, { mount, wide, actions = "" } = {}) {
    close(true);
    const back = document.activeElement;
    const host = document.createElement("div");
    host.className = "sheet-host";
    host.innerHTML = `<div class="scrim" data-close></div><section class="sheet ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header><div class="grab" aria-hidden="true"></div><h2>${esc(title)}</h2>${actions}<button class="round" data-close aria-label="Close">${ico("close")}</button></header><div class="sheet-body">${html}</div></section>`;
    document.body.appendChild(host);
    document.documentElement.classList.add("sheet-open");
    const onKey = (e) => { if (e.key === "Escape") close(); };
    host.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) close(); });
    addEventListener("keydown", onKey);
    const vv = window.visualViewport;
    const fitKeyboard = () => { if (!vv) return; const kb = Math.max(0, innerHeight - vv.height - vv.offsetTop); host.style.setProperty("--kb", kb + "px"); host.style.setProperty("--vvh", vv.height + "px"); };
    fitKeyboard(); vv && vv.addEventListener("resize", fitKeyboard); vv && vv.addEventListener("scroll", fitKeyboard);
    // A focused field scrolls into the part of the sheet you can see.
    host.addEventListener("focusin", (e) => { if (e.target.matches("input, textarea, select")) setTimeout(() => e.target.scrollIntoView({ block: "nearest", behavior: "smooth" }), 320); });
    current = { host, back, onKey, fitKeyboard };
    requestAnimationFrame(() => requestAnimationFrame(() => host.classList.add("open")));
    mount && mount(host.querySelector(".sheet-body"), close);
    setTimeout(() => (host.querySelector("[autofocus]") || host.querySelector(".sheet header .round")).focus({ preventScroll: true }), 60);
    return close;
  }
  function close(instant) {
    if (!current) return;
    const { host, back, onKey, fitKeyboard } = current;
    current = null;
    removeEventListener("keydown", onKey);
    window.visualViewport && visualViewport.removeEventListener("resize", fitKeyboard);
    host.classList.remove("open");
    document.documentElement.classList.remove("sheet-open");
    setTimeout(() => host.remove(), instant === true ? 0 : 380);
    back && back.isConnected && back.focus && back.focus({ preventScroll: true });
  }

  // The app's frame: a bottom tab bar on the phone and a sidebar from 900 px, with screens pushed
  // on top (a back button, a slide). screen(tab, note) returns a screen's HTML; after(tab) wires it.
  function app({ tabs, screen, after, header }) {
    if (schema.length && !tabs.some((t) => t.id === "settings")) tabs = [...tabs, { id: "settings", label: "Settings", icon: "gear" }];
    const st = { tab: tabs[0].id, stack: [], scroll: {}, dir: "" };
    const root = document.getElementById("app");
    root.classList.add("shell-root");
    function draw(note = amber.note) {
      const top = st.stack[st.stack.length - 1];
      const t = tabs.find((x) => x.id === st.tab);
      const content = top ? top.render(note) : st.tab === "settings" ? `<header class="top"><div class="titles"><h1>Settings</h1></div></header>${settingsHTML()}` : screen(st.tab, note);
      const titleHTML = top ? `<header class="push-h"><button class="backb" data-pop aria-label="Back to ${esc(top.backLabel || t.label)}">${ico("back")}<span>${esc(top.backLabel || t.label)}</span></button></header>` : "";
      root.innerHTML = `<div class="shell ${top && top.immersive ? "immersive" : ""}">
        <nav class="sidebar" aria-label="Sections"><div class="sb-title">${esc(note.title)}</div>${header ? header(note) : ""}${tabs.map((x) => `<button class="sb-item" data-tab="${x.id}" aria-current="${x.id === st.tab ? "page" : "false"}">${ico(x.icon)}<span>${esc(x.label)}</span>${x.badge && x.badge(note) ? `<i class="badge num">${x.badge(note)}</i>` : ""}</button>`).join("")}</nav>
        <div class="screen ${st.dir}" id="screen">${titleHTML}${content}</div>
        <nav class="tabbar" aria-label="Sections">${tabs.map((x) => `<button class="tb-item" data-tab="${x.id}" aria-current="${x.id === st.tab ? "page" : "false"}">${ico(x.icon)}<span>${esc(x.label)}</span>${x.badge && x.badge(note) ? `<i class="badge num">${x.badge(note)}</i>` : ""}</button>`).join("")}</nav>
      </div>`;
      st.dir = "";
      if (top && top.after) top.after(document.getElementById("screen")); else if (!top && after && st.tab !== "settings") after(st.tab, document.getElementById("screen"));
    }
    root.addEventListener("click", (e) => {
      const tb = e.target.closest("[data-tab]");
      if (tb) {
        st.scroll[st.tab] = scrollY;
        const same = tb.dataset.tab === st.tab;
        st.tab = tb.dataset.tab; st.stack = []; st.dir = same ? "" : "fade";
        draw(); scrollTo(0, same ? 0 : st.scroll[st.tab] || 0); return;
      }
      if (e.target.closest("[data-pop]")) pop();
    });
    addEventListener("keydown", (e) => { if (e.key === "Escape" && st.stack.length && !current) pop(); });
    function push(scr) { st.scroll["push" + st.stack.length] = scrollY; st.stack.push(scr); st.dir = "in"; draw(); scrollTo(0, 0); }
    function pop() { if (!st.stack.length) return; st.stack.pop(); st.dir = "out"; draw(); scrollTo(0, st.scroll["push" + st.stack.length] || 0); }
    return { draw, push, pop, get tab() { return st.tab; }, set tab(v) { st.tab = v; st.stack = []; draw(); }, get depth() { return st.stack.length; } };
  }

  // App settings: declared once in <meta name="app-settings"> (types: number, text, time, toggle,
  // choice with options as strings or {value, label}, list, currency), shown inside the app as its
  // own Settings screen, and kept in the app's own data under values.settings.
  const schema = (() => { const m = document.querySelector('meta[name="app-settings"]'); try { return m ? JSON.parse(m.content).settings : []; } catch (e) { console.error("app-settings:", e.message); return []; } })();
  const settings = () => Object.assign({}, ...schema.map((f) => ({ [f.key]: f.default })), (amber.data.values && amber.data.values.settings) || {});
  const optVal = (o) => (o && typeof o === "object" ? o.value : o), optLabel = (o) => (o && typeof o === "object" ? o.label : o);
  const CURRENCIES = ["SEK", "NOK", "DKK", "EUR", "USD", "GBP", "CHF", "JPY"];
  function settingsHTML() {
    const s = settings();
    const row = (f) => {
      const id = "set-" + f.key, v = s[f.key];
      const help = f.help ? `<div class="muted small">${esc(f.help)}</div>` : "";
      if (f.type === "toggle") return `<label class="row setrow" for="${id}"><span class="grow">${esc(f.label)}${help}</span><input class="switch" type="checkbox" role="switch" id="${id}" data-set="${f.key}" ${v ? "checked" : ""}></label>`;
      let input;
      if (f.type === "choice" || f.type === "currency") input = `<select class="in" id="${id}" data-set="${f.key}">${(f.type === "currency" ? CURRENCIES : f.options).map((o) => `<option value="${esc(optVal(o))}" ${String(optVal(o)) === String(v) ? "selected" : ""}>${esc(optLabel(o))}</option>`).join("")}</select>`;
      else if (f.type === "list") input = `<input class="in" id="${id}" data-set="${f.key}" value="${esc((Array.isArray(v) ? v : []).join(", "))}">`;
      else input = `<input class="in ${f.type === "number" ? "num" : ""}" id="${id}" data-set="${f.key}" type="${f.type === "number" ? "number" : f.type === "time" ? "time" : "text"}" ${f.type === "number" ? 'inputmode="decimal"' : ""} value="${esc(v ?? "")}">`;
      return `<div class="row setrow"><label class="grow" for="${id}">${esc(f.label)}${help}</label><div class="set-input">${input}</div></div>`;
    };
    return `<section class="card list settings-list">${schema.map(row).join("")}</section><p class="muted small" style="margin:.7rem .3rem 0">Kept with this note's app, on all your devices.</p>`;
  }
  function saveSetting(el) {
    const f = schema.find((x) => x.key === el.dataset.set); if (!f) return;
    let v;
    if (f.type === "toggle") v = el.checked;
    else if (f.type === "number") { v = parseFloat(String(el.value).replace(",", ".")); if (!Number.isFinite(v)) v = f.default; }
    else if (f.type === "list") v = el.value.split(",").map((x) => x.trim()).filter(Boolean);
    else if (f.type === "choice") { const o = f.options.find((x) => String(optVal(x)) === el.value); v = o != null ? optVal(o) : el.value; }
    else v = el.value;
    return amber.setData({ values: { settings: { [f.key]: v } } });
  }
  document.addEventListener("change", (e) => { const el = e.target.closest && e.target.closest("[data-set]"); if (el) saveSetting(el); });
  const openSettings = () => sheet("Settings", settingsHTML());
  document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest("[data-settings]")) openSettings(); });

  const on = (v) => v === true || v === "On" || v === "on" || v === "Yes";

  // Charts drawn at their real width (so 10 px labels stay 10 px): width(key) is the last measured
  // inner width of the element with data-w="key"; fit(render) re-renders once when a width changed.
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

  return { schema, settingsHTML, openSettings, app, width, fit, onResize, esc, $, $$, ico, D, num, kr, fmtN, done, col, table, addRows, sheet, close, settings, on, once, hash, announce };
})();
