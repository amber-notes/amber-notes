/// <reference lib="dom" />
// Opens a note's app the way Amber Notes does (the same CSP, theme, window.amber bridge, no network)
// in headless WebKit at the widths and color schemes asked for, and measures it: script errors,
// overflow, contrast, small or faint text, unlabeled controls, an edit from the app, and probes
// over changed notes. Used by the render service (server.ts, behind check_app and preview_app) and
// by the evals. Edits run through page_input.ts, the TypeScript twin of Pane/Model/NotePage.swift.
import { webkit, type Browser, type Page } from "npm:playwright-core@1.63.0";
import { applyPageOp, noteForPage } from "../../supabase/functions/mcp/page_input.ts";
import { mergePatch } from "../../supabase/functions/mcp/data_ops.ts";
import { findTables } from "../../supabase/functions/mcp/notes.ts";

// Pane/Views/NotePageView.swift: NotePageSandbox.policy and sandboxed(_:).
const POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; " +
  "connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'";

// NotePageTheme.css as the iPhone app writes it (Pane/Views/NotePageView.swift, Palette).
const vars = (d: boolean) => [
  ["--amber-bg", d ? "#000000" : "#FFFEFD"], ["--amber-surface", d ? "#1C1B1A" : "#F4F1EE"], ["--amber-fill", d ? "#2C2A28" : "#EBE6E1"],
  ["--amber-text", d ? "#F6EFE7" : "#2A1D10"], ["--amber-text-secondary", d ? "#BCB0A3" : "#74604C"],
  ["--amber-separator", d ? "rgba(255, 250, 245, 0.10)" : "rgba(138, 74, 28, 0.14)"], ["--amber-accent", d ? "#F4AD33" : "#D96A06"],
  ["--amber-accent-text", d ? "#F4AD33" : "#A85700"], ["--amber-accent-soft", d ? "#423014" : "#FFF1DC"], ["--amber-on-accent", d ? "#1F1300" : "#FFFFFF"],
  ["--amber-danger", d ? "#FF6B5E" : "#C62828"],
].map(([k, v]) => `${k}: ${v}`).join("; ");
export const THEME = `:root { color-scheme: light dark; ${vars(false)}; --amber-radius: 14px; --amber-radius-small: 10px; --amber-content-max: 1100px; --amber-gutter: clamp(16px, 3.5vw, 40px); ` +
  `--amber-font: -apple-system, system-ui, sans-serif; --amber-font-rounded: ui-rounded, -apple-system, system-ui, sans-serif; --amber-font-mono: ui-monospace, Menlo, monospace; }\n` +
  `@media (prefers-color-scheme: dark) { :root { ${vars(true)}; } }\n` +
  `body { margin: 0; background: var(--amber-bg); color: var(--amber-text); font: 17px/1.35 var(--amber-font); -webkit-text-size-adjust: 100%; }`;

export function sandboxed(html: string): string {
  let rest = html.replace(/^[\s\uFEFF]+/, "");
  if (/^<!doctype/i.test(rest)) rest = rest.slice(rest.indexOf(">") + 1);
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${POLICY}"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<style id="amber-theme">${THEME}</style>` + rest;
}

// Pane/Views/NotePageView.swift bootstrap(data:store:), with the app's message handlers replaced by
// the harness's. The device, the on-device model and amber.fetch answer { ok: false } here: the
// evals check pages handle that, not what the device returns.
const bootstrap = (note: unknown, data: unknown, defaults: Record<string, unknown> = {}) => `(() => {
  const listeners = [];
  const ask = (msg) => window.__amberData(msg)
    .then((r) => { if (r && r.data) amber.data = r.data; if (r) delete r.data; return r; })
    .catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
  const unavailable = (what) => () => Promise.resolve({ ok: false, error: what + " isn't available here." });
  // Frames the page asks for, so a check can tell whether it animates (a game that plays).
  window.__frames = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (fn) => { window.__frames++; return raf(fn); };
  const amber = {
    note: ${JSON.stringify(note)},
    update(op) { return window.__amberUpdate(op).catch((e) => ({ ok: false, error: String((e && e.message) || e) })); },
    onChange(fn) { listeners.push(fn); try { fn(amber.note, amber.data); } catch (e) { console.error(e); } },
    data: ${JSON.stringify(data)},
    setData(patch) { return ask({ op: "store.patch", patch }); },
    store: {
      get: (key) => Promise.resolve(amber.data.values[key]),
      set: (key, value) => ask({ op: "store.set", key, value: value === undefined ? null : value }),
      collection(name) {
        const list = () => (amber.data.collections[name] || []).slice();
        return {
          list: () => Promise.resolve(list()), query: (fn) => Promise.resolve(list().filter(fn)), get: (id) => Promise.resolve(list().find((r) => r.id === id)),
          add: (fields) => ask({ op: "collection.add", name, fields }), update: (id, patch) => ask({ op: "collection.update", name, id, patch }),
          remove: (id) => ask({ op: "collection.remove", name, id }),
        };
      },
      subscribe(fn) { amber.onChange((note, data) => fn(data)); },
    },
    files: { save: unavailable("Files"), read: unavailable("Files") },
    device: {
      reminders: { create: unavailable("Reminders") }, calendar: { today: unavailable("Calendar") }, notify: unavailable("Notifications"),
      openURL: unavailable("Opening links"), photos: { pick: unavailable("Photos") }, camera: { take: unavailable("The camera") },
      contacts: { pick: unavailable("Contacts") }, files: { pick: unavailable("Files") }, location: { once: unavailable("Location") },
      maps: { open: unavailable("Maps"), snapshot: unavailable("Maps") }, weather: { current: unavailable("Weather") },
    },
    ai: { available: () => Promise.resolve({ ok: true, available: false }), respond: unavailable("The on-device model") },
    fetch: (url) => { window.__amberFetched && window.__amberFetched(String(url)); return Promise.resolve({ ok: false, error: "The person hasn't allowed this host yet." }); },
  };
  Object.defineProperty(amber, "_receive", { value(note, data) {
    amber.note = note; if (data) amber.data = data;
    for (const fn of listeners) { try { fn(note, amber.data); } catch (e) { console.error(e); } }
  } });
  const settingDefaults = ${JSON.stringify(defaults)};
  Object.defineProperty(amber, "settings", { get() { return Object.assign({}, settingDefaults, (amber.data.values && amber.data.values.settings) || {}); } });
  window.amber = amber;
  const sized = () => { if (!document.documentElement) return addEventListener("DOMContentLoaded", sized, { once: true }); const w = window.innerWidth, c = document.documentElement.classList;
    c.toggle("amber-narrow", w < 600); c.toggle("amber-medium", w >= 600 && w < 900); c.toggle("amber-wide", w >= 900); };
  sized(); addEventListener("resize", sized);
})();`;

/** <meta name="amber-settings">: each setting's default, as the app fills them in. */
function settingDefaults(html: string): Record<string, unknown> {
  const content = html.match(/<meta[^>]*name=["']amber-settings["'][^>]*>/i)?.[0]?.match(/content=(['"])([\s\S]*?)\1/)?.[2];
  try { return Object.fromEntries((JSON.parse(content ?? "{}").settings ?? []).filter((x: { key?: string }) => x.key).map((x: { key: string; default?: unknown }) => [x.key, x.default ?? null])); } catch { return {}; }
}

/** The app's data ops (Pane/Model/NotePageData.swift apply). */
function applyDataOp(doc: { values: Record<string, unknown>; collections: Record<string, Record<string, unknown>[]> }, m: Record<string, unknown>) {
  const d = JSON.parse(JSON.stringify(doc)) as typeof doc;
  const now = new Date().toISOString();
  const list = (n: unknown) => (d.collections[String(n)] ??= []);
  let id: string | undefined;
  switch (m.op) {
    case "store.set": if (m.value === null) delete d.values[String(m.key)]; else d.values[String(m.key)] = m.value; break;
    case "store.patch": { const p = mergePatch(d, m.patch) as typeof doc; d.values = p.values ?? {}; d.collections = p.collections ?? {}; break; }
    case "collection.add": {
      const f = { ...(m.fields as Record<string, unknown>) }, l = list(m.name);
      id = typeof f.id === "string" && !l.some((r) => r.id === f.id) ? f.id : crypto.randomUUID();
      l.push({ ...f, id, created: f.created ?? now, updated: now }); break;
    }
    case "collection.update": {
      const l = list(m.name), k = l.findIndex((r) => r.id === m.id);
      if (k < 0) throw new Error(`No record ${m.id} in ${m.name}.`);
      l[k] = { ...(mergePatch(l[k], m.patch) as Record<string, unknown>), id: m.id, updated: now }; break;
    }
    case "collection.remove": {
      const l = list(m.name), k = l.findIndex((r) => r.id === m.id);
      if (k < 0) throw new Error(`No record ${m.id} in ${m.name}.`);
      l.splice(k, 1); break;
    }
    default: throw new Error(`Unknown op ${m.op}.`);
  }
  if (new TextEncoder().encode(JSON.stringify(d)).length > 4 * 1048576) throw new Error("This app's data would be over 4 MB.");
  return { d, id };
}

export type View = {
  name: string; width: number; scheme: "light" | "dark";
  errors: string[]; overflowPx: number; textLength: number; shown: number; sampled: number;
  bg: string; fg: string; contrast: number; bgLuminance: number;
  unnamedControls: string[]; smallTargets: number; screenshot?: string;
  smallText: string[]; smallTextCount: number; faintText: string[]; faintCount: number; headings: string[]; excerpt: string; png?: string;
  under44: string[]; under44Count: number; clipped: string[]; clippedCount: number; usedWidth: number; canvases: number; svgShapes: number; gridCols: number; frames: number;
};
export type Render = {
  views: View[]; blocked: string[]; updates: { op: unknown; ok: boolean; error?: string }[]; setData: number;
  interaction: { tried: string; ok: boolean | null; error?: string; framesPerSecond?: number };
  probes: Partial<Record<"follows" | "escapes" | "empty" | "large", { pass: boolean; detail?: string }>>;
  markdownAfter: string; dataAfter: unknown;
};

let browser: Browser | null = null;
export async function closeBrowser() { await browser?.close(); browser = null; }

function lum(rgb: string): number {
  const m = rgb.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  const [r, g, b] = m.slice(0, 3).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrastOf = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** Values from the note that a page showing its data would show: the last rows' non-empty cells. */
function samples(markdown: string): string[] {
  const out: string[] = [];
  for (const t of findTables(markdown)) {
    for (const r of [...t.rows.slice(0, 2), ...t.rows.slice(-3)]) for (const c of r) if (c && c.length >= 2 && c.length <= 40 && !/^[\s✓✔xX·-]+$/.test(c) && !/^\d{4}-\d{2}-\d{2}$/.test(c)) out.push(c);
  }
  return [...new Set(out)].slice(0, 12);
}

export type RenderOptions = {
  shots?: string; today: string; interact?: boolean;
  /** Which widths and color schemes (default 375 light and dark, 768 light, 1280 light and dark). */
  views?: { width: number; scheme: "light" | "dark" }[];
  /** Keep a PNG of each view in the result (for preview_app). */
  capture?: boolean;
  /** Skip the robustness probes (for a quick check). */
  probes?: boolean;
};

/** Renders, starting WebKit again (once) if it went away under load. */
export async function renderPage(html: string, markdown: string, data: unknown, opts: RenderOptions): Promise<Render> {
  try {
    return await renderOnce(html, markdown, data, opts);
  } catch (e) {
    if (!/closed|crash|disconnect/i.test(String(e))) throw e;
    await browser?.close().catch(() => {});
    browser = null;
    return await renderOnce(html, markdown, data, opts);
  }
}

async function renderOnce(html: string, markdown: string, data: unknown, opts: RenderOptions): Promise<Render> {
  if (browser && !browser.isConnected()) browser = null;
  browser ??= await webkit.launch();
  const empty = (x: unknown) => ({ values: {}, collections: {}, ...(x as object ?? {}) });
  let md = markdown, store: unknown = empty(data);
  const updates: Render["updates"] = [];
  const blocked: string[] = [];
  let setData = 0;
  const views: View[] = [];
  let interaction: Render["interaction"] = { tried: "none", ok: null };
  const want = samples(markdown);

  const open = async (width: number, scheme: "light" | "dark"): Promise<{ page: Page; errors: string[] }> => {
    const ctx = await browser!.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, colorScheme: scheme, deviceScaleFactor: width < 600 ? 2 : 1 });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
    page.on("pageerror", (e) => errors.push(`pageerror: ${String(e.message).slice(0, 300)}`));
    // The document is served at one made-up address, so init scripts run on it like the app's
    // user script; every other request is recorded and refused.
    const home = "https://page.amber.invalid/";
    await page.route("**/*", (r) => {
      const u = r.request().url();
      if (u === home) return r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: sandboxed(html) });
      if (u.startsWith("data:")) return r.continue();
      blocked.push(u);
      return r.abort();
    });
    await page.exposeFunction("__amberUpdate", async (op: unknown) => {
      try {
        md = applyPageOp(md, op);
        updates.push({ op, ok: true });
        await page.evaluate(([n, d]) => (window as any).amber._receive(n, d), [noteForPage(md, opts.today), store]);
        return { ok: true };
      } catch (e) {
        updates.push({ op, ok: false, error: (e as Error).message });
        return { ok: false, error: (e as Error).message };
      }
    });
    await page.exposeFunction("__amberData", async (msg: Record<string, unknown>) => {
      try {
        const { d, id } = applyDataOp(store as Parameters<typeof applyDataOp>[0], msg);
        store = d; setData++;
        await page.evaluate(([n, x]) => (window as any).amber._receive(n, x), [noteForPage(md, opts.today), store]);
        return { ok: true, ...(id ? { id } : {}), data: store };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    });
    await page.addInitScript(bootstrap(noteForPage(md, opts.today), store, settingDefaults(html)));
    await page.goto(home, { waitUntil: "load", timeout: 15000 }).catch((e) => errors.push(`load: ${(e as Error).message.slice(0, 200)}`));
    await page.waitForTimeout(400);
    return { page, errors };
  };

  const wanted = opts.views ?? ([[375, "light"], [375, "dark"], [768, "light"], [1280, "light"], [1280, "dark"]] as const).map(([width, scheme]) => ({ width, scheme }));
  for (const { width, scheme } of wanted) {
    md = markdown; store = empty(data);
    const { page, errors } = await open(width, scheme);
    const m = await page.evaluate((want: string[]) => {
      const de = document.documentElement;
      const text = document.body?.innerText ?? "";
      const flat = text.replace(/\s+/g, " ").toLowerCase();
      const bodyStyle = getComputedStyle(document.body);
      let bg = bodyStyle.backgroundColor;
      if (/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) bg = getComputedStyle(de).backgroundColor;
      if (/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) bg = "rgb(255, 255, 255)";
      const name = (el: Element) => {
        const a = el.getAttribute("aria-label") || "";
        const lb = el.getAttribute("aria-labelledby");
        const byId = lb ? lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ") : "";
        const labels = (el as HTMLInputElement).labels ? [...(el as HTMLInputElement).labels!].map((l) => l.textContent ?? "").join(" ") : "";
        const own = el.tagName === "BUTTON" || el.getAttribute("role") === "button" ? (el.textContent ?? "") : "";
        const title = el.getAttribute("title") || "";
        return (a + byId + labels + own + title).trim();
      };
      const visible = (el: Element) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      const controls = [...document.querySelectorAll("input:not([type=hidden]), select, textarea, button, [role=button], [role=checkbox]")].filter(visible);
      const unnamed = controls.filter((el) => !name(el)).map((el) => el.outerHTML.slice(0, 120));
      const small = controls.filter((el) => { const r = el.getBoundingClientRect(); return r.height < 28 || r.width < 28; }).length;
      // A control's tap area: its own box, or its label's when the label wraps it.
      const tapBox = (el: Element) => { const r = el.getBoundingClientRect(); const l = (el as HTMLInputElement).labels?.[0]; if (!l) return r; const b = l.getBoundingClientRect(); return b.width * b.height > r.width * r.height ? b : r; };
      const under44 = controls.filter((el) => { const r = tapBox(el); return r.height < 40 || r.width < 40; }).map((el) => (el.textContent ?? el.getAttribute("aria-label") ?? el.tagName).trim().slice(0, 30));
      // How much of the window's width the content uses.
      let left = Infinity, right = -Infinity;
      for (const el of document.querySelectorAll("body *")) {
        if (!visible(el)) continue;
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()) || ["CANVAS", "SVG", "IMG", "INPUT", "BUTTON", "SELECT", "TEXTAREA"].includes(el.tagName.toUpperCase());
        if (!own) continue;
        const r = el.getBoundingClientRect();
        left = Math.min(left, r.left); right = Math.max(right, r.right);
      }
      const used = right > left ? (right - left) / window.innerWidth : 0;
      // What kind of layout: canvas, drawn SVG, multi-column grids, or a stack of rows.
      const canvases = [...document.querySelectorAll("canvas")].filter(visible).length;
      const svgShapes = [...document.querySelectorAll("svg path, svg rect, svg circle, svg line, svg polyline, svg polygon, svg ellipse")].filter(visible).length;
      const gridCols = Math.max(0, ...[...document.querySelectorAll("body *")].filter(visible).map((el) => { const s = getComputedStyle(el); return s.display.includes("grid") ? s.gridTemplateColumns.split(" ").filter(Boolean).length : 0; }));
      // Text that is small or faint against what's behind it.
      const lumOf = (c: string) => { const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0]; const [r, g, b] = m.slice(0, 3).map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const behind = (el: Element | null): string => { for (let e = el; e; e = e.parentElement) { const b = getComputedStyle(e).backgroundColor; if (!/rgba\(0, 0, 0, 0\)|transparent/.test(b) && !/rgba\([^)]*, 0(\.0+)?\)$/.test(b)) return b; } return bg; };
      const texts = [...document.querySelectorAll("body *")].filter((el) => visible(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()));
      // Text cut off by its box (no ellipsis meant).
      const clipped = texts.filter((el) => { const s = getComputedStyle(el); return el.clientWidth > 2 && s.clip !== "rect(0px, 0px, 0px, 0px)" && !(s.position === "absolute" && el.clientWidth <= 2) && el.scrollWidth > el.clientWidth + 2 && s.overflowX !== "visible" && s.textOverflow !== "ellipsis" && s.overflowX !== "auto" && s.overflowX !== "scroll"; }).map((el) => (el.textContent ?? "").trim().slice(0, 40));
      const smallText = texts.filter((el) => parseFloat(getComputedStyle(el).fontSize) < 12).map((el) => (el.textContent ?? "").trim().slice(0, 40));
      const faint = texts.filter((el) => { const s = getComputedStyle(el); if (parseFloat(s.opacity) < 0.3) return false; const a = lumOf(s.color), b = lumOf(behind(el)); const [x, y] = [a, b].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) < 4.5; }).map((el) => (el.textContent ?? "").trim().slice(0, 40));
      return {
        under44: under44.slice(0, 5), under44Count: under44.length, clipped: clipped.slice(0, 5), clippedCount: clipped.length, used,
        canvases, svgShapes, gridCols, frames: (window as any).__frames as number,
        smallText: smallText.slice(0, 5), smallTextCount: smallText.length, faint: faint.slice(0, 5), faintCount: faint.length,
        headings: [...document.querySelectorAll("h1, h2, h3, [role=heading]")].filter(visible).map((h) => (h.textContent ?? "").trim().slice(0, 80)).slice(0, 12),
        excerpt: text.replace(/\s+/g, " ").trim().slice(0, 500),
        overflow: Math.max(0, de.scrollWidth - window.innerWidth), textLength: text.trim().length,
        shown: want.filter((w) => flat.includes(w.toLowerCase().replace(/\s+/g, " ")) || (/^[\d\s.,\u00a0]+$/.test(w) && flat.replace(/[\s,\u00a0\u202f]/g, "").includes(w.replace(/[\s,\u00a0]/g, "")))).length,
        bg, fg: bodyStyle.color, unnamed, small,
      };
    }, want).catch((e) => ({ overflow: 0, textLength: 0, shown: 0, bg: "rgb(255,255,255)", fg: "rgb(0,0,0)", unnamed: [] as string[], small: 0, smallText: [] as string[], smallTextCount: 0, faint: [] as string[], faintCount: 0, headings: [] as string[], excerpt: "", under44: [] as string[], under44Count: 0, clipped: [] as string[], clippedCount: 0, used: 0, canvases: 0, svgShapes: 0, gridCols: 0, frames: 0, err: String(e) }));
    let shot: string | undefined;
    if (opts.shots && (width < 600 || scheme === "light")) {
      shot = `${opts.shots}-${width}-${scheme}.png`;
      await page.screenshot({ path: shot, fullPage: width < 600 }).catch(() => (shot = undefined));
    }
    let png: string | undefined;
    if (opts.capture) {
      const full = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 900);
      const buf = await page.screenshot({ clip: { x: 0, y: 0, width, height: Math.min(full, width < 600 ? 1700 : 1100) } }).catch(() => null);
      if (buf) png = btoa(Array.from(buf, (b) => String.fromCharCode(b)).join(""));
    }
    views.push({ name: `${width}-${scheme}`, width, scheme, errors, overflowPx: m.overflow, textLength: m.textLength, shown: m.shown, sampled: want.length,
      bg: m.bg, fg: m.fg, contrast: contrastOf(m.bg, m.fg), bgLuminance: lum(m.bg), unnamedControls: m.unnamed, smallTargets: m.small, screenshot: shot,
      smallText: m.smallText, smallTextCount: m.smallTextCount, faintText: m.faint, faintCount: m.faintCount, headings: m.headings, excerpt: m.excerpt,
      under44: m.under44, under44Count: m.under44Count, clipped: m.clipped, clippedCount: m.clippedCount, usedWidth: m.used, canvases: m.canvases, svgShapes: m.svgShapes, gridCols: m.gridCols, frames: m.frames, ...(png ? { png } : {}) });

    await page.context().close();
  }

  // Can the page edit the note? On the phone: fill in and submit the first form, else press
  // checkbox-like controls and then buttons, one at a time, until an edit lands.
  md = markdown; store = empty(data);
  const viewUpdates = updates.length;
  if (opts.interact) {
    const { page, errors } = await open(375, "light");
    const errs = errors.length;
    const before = updates.length + setData;
    for (let k = 0; k < 8 && updates.length + setData === before; k++) {
      const tried = await page.evaluate((k: number) => {
        const form = document.querySelector("form");
        if (k === 0 && form) {
          for (const el of form.querySelectorAll("input, textarea")) {
            const i = el as HTMLInputElement;
            if (["hidden", "submit", "button", "checkbox", "radio"].includes(i.type) || i.value) continue;
            const hint = (i.name + " " + i.placeholder + " " + (i.labels?.[0]?.textContent ?? "") + " " + (i.getAttribute("aria-label") ?? "")).toLowerCase();
            i.value = i.type === "email" ? "test@example.com" : i.type === "url" ? "" : i.type === "number" || /amount|kr|price|cost|km|min|value|sum|rating|goal/.test(hint) || i.inputMode === "decimal" || i.inputMode === "numeric" ? "3" : i.type === "date" ? (window as any).amber.note.today : "Test entry";
            i.dispatchEvent(new Event("input", { bubbles: true }));
          }
          const b = form.querySelector("button:not([type=button]), input[type=submit]") as HTMLElement | null;
          if (b) b.click(); else form.requestSubmit();
          return "form";
        }
        const pool = [...document.querySelectorAll("input[type=checkbox], [role=checkbox], [aria-pressed], [data-line], button:not(form button)")]
          .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !(el as HTMLButtonElement).disabled; });
        const el = pool[k - (form ? 1 : 0)] as HTMLElement | undefined;
        if (!el) return "none";
        el.click();
        return "control";
      }, k).catch(() => "error");
      if (tried === "none" || tried === "error") { if (k === 0) interaction = { tried: tried, ok: tried === "none" ? null : false }; break; }
      interaction = { tried, ok: null };
      await page.waitForTimeout(300);
    }
    // Does it move after that (a game or toy that plays)? Frames asked for over the next second.
    const f0 = await page.evaluate(() => (window as any).__frames as number).catch(() => 0);
    await page.waitForTimeout(1000);
    interaction.framesPerSecond = (await page.evaluate(() => (window as any).__frames as number).catch(() => 0)) - f0;
    if (interaction.tried === "form" || interaction.tried === "control") {
      const fresh = updates.slice(viewUpdates);
      const landed = updates.length + setData > before;
      interaction.ok = landed && fresh.every((u) => u.ok) && errors.length === errs;
      if (!interaction.ok) interaction.error = fresh.find((u) => !u.ok)?.error ?? (errors.length > errs ? errors[errors.length - 1] : "no control sent an edit");
    }
    await page.context().close();
  }
  if (viewUpdates) interaction.error = `${viewUpdates} edit(s) were sent just by opening the page`;

  // Robustness: the same page over changed notes. A new row with markup in it (does the page
  // follow the note, and escape it?), every row removed, and 400 rows.
  const probes: Render["probes"] = {};
  if (opts.probes === false) return { views, blocked: [...new Set(blocked)], updates, setData, interaction, probes, markdownAfter: markdown, dataAfter: data };
  const tables = findTables(markdown);
  const main = tables.slice().sort((a, b) => b.rows.length - a.rows.length)[0];
  const lines = markdown.split("\n");
  const rowAt = (t: typeof main) => { const out: number[] = []; for (let k = t.start; k <= t.end; k++) if (/^\s*\|/.test(lines[k]) && !/^[\s|:-]+$/.test(lines[k])) out.push(k); return out.slice(1); };
  const PROBE = 'Zq <b>probe</b> & "x"';
  const textCol = main ? main.columns.findIndex((c, k) => c.type.kind === "text" && !/date|day/i.test(c.name) && main.rows.some((r) => r[k] && !/^[\d\s.,✓✔xX·-]+$/.test(r[k]))) : -1;
  const measure = async (body: string) => {
    md = body; store = empty(data);
    const t0 = performance.now();
    const { page, errors } = await open(375, "light");
    const ms = performance.now() - t0;
    const r = await page.evaluate((probe: string) => ({ text: document.body?.innerText ?? "", injected: [...document.querySelectorAll("b")].some((b) => b.textContent === "probe" && (b.parentElement?.textContent ?? "").includes("Zq")) }), PROBE).catch(() => ({ text: "", injected: false }));
    await page.context().close();
    return { errors, ms, ...r };
  };
  if (main && textCol >= 0 && main.rows.length) {
    const cells = [...main.rows[main.rows.length - 1]];
    cells[textCol] = PROBE;
    const at = rowAt(main);
    const l2 = [...lines];
    l2.splice(at[at.length - 1] + 1, 0, "| " + cells.map((c) => c.replace(/\|/g, "\\|")).join(" | ") + " |");
    const r = await measure(l2.join("\n"));
    probes.follows = { pass: r.text.includes(PROBE) && r.errors.length === 0, detail: r.errors[0] ?? (r.injected ? "markup from the note ran as HTML" : r.text.includes("Zq") ? "shown, but not as written" : "a new row in the note doesn't show") };
    probes.escapes = { pass: !r.injected && r.errors.length === 0, detail: r.injected ? "markup from the note ran as HTML" : r.errors[0] };
  }
  if (tables.length) {
    const drop = new Set(tables.flatMap((t) => rowAt(t)));
    const empty = lines.filter((l, k) => !drop.has(k) && !/^\s*[-*+]\s+\[[ xX]\]/.test(l)).join("\n");
    const r = await measure(empty);
    probes.empty = { pass: r.errors.length === 0 && r.text.trim().length > 0, detail: r.errors[0] ?? "blank page" };
  }
  if (main && main.rows.length) {
    const at = rowAt(main);
    const extra: string[] = [];
    for (let k = 0; extra.length + main.rows.length < 400; k++) extra.push(lines[at[k % at.length]]);
    const l2 = [...lines];
    l2.splice(at[at.length - 1] + 1, 0, ...extra);
    const r = await measure(l2.join("\n"));
    probes.large = { pass: r.errors.length === 0 && r.ms < 3000, detail: r.errors[0] ?? `${Math.round(r.ms)} ms to load 400 rows` };
  }
  return { views, blocked: [...new Set(blocked)], updates, setData, interaction, probes, markdownAfter: markdown, dataAfter: data };
}
