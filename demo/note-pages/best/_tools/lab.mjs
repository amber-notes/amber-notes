// A quick WebKit check for a note app, outside Amber Notes: a stand-in for the bridge (note ops,
// the app's data, device calls answered with stand-ins), the theme tokens, the bundled libraries.
// Muted: no sound can play. Reports console errors and anything wider than the window.
//   node lab.mjs <appdir> [--out dir] [--only phone-light,wide-dark,small-light] [--scenario]
import { webkit } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2), dir = path.resolve(args[0]);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const out = path.resolve(opt("--out", path.join(dir, "..", "..", "..", "..", ".shots", "lab", path.basename(dir))));
fs.mkdirSync(out, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const shift = (n) => { const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const tokens = (s) => s.replace(/\{\{d([+-]\d+)?\}\}/g, (_, n) => shift(+(n || 0))).replace(/\{\{t([+-]\d+)?(?:@(\d\d):(\d\d))?\}\}/g, (_, n, h, m) => `${shift(+(n || 0))}T${h || "12"}:${m || "00"}:00Z`);
const read = (f) => (fs.existsSync(path.join(dir, f)) ? tokens(fs.readFileSync(path.join(dir, f), "utf8")) : null);
const html = fs.readFileSync(path.join(dir, "app.html"), "utf8");
const body = read("note.md") || "", data = JSON.parse(read("data.json") || '{"values":{},"collections":{}}');
const LIBDIR = path.resolve(dir, "../../../../Pane/Resources/AppLibraries");
const man = JSON.parse(fs.readFileSync(path.join(LIBDIR, "libraries.json"), "utf8")).libraries;
const want = (/<meta[^>]*name=["']amber-libs["'][^>]*content=["']([^"']*)/i.exec(html) || [, ""])[1].split(",").map((x) => x.trim()).filter(Boolean);
const order = []; const add = (n) => { const m = man.find((l) => l.name === n); if (!m || order.includes(m)) return; (m.needs || (n === "htm" || n === "router" ? ["preact", "preact-hooks"] : n === "preact-hooks" ? ["preact"] : [])).forEach(add); order.push(m); };
want.forEach(add);
const libs = order.map((m) => `<script>${fs.readFileSync(path.join(LIBDIR, m.file), "utf8")}</script>`).join("");
const base = fs.existsSync(path.join(LIBDIR, "amber-base.css")) ? fs.readFileSync(path.join(LIBDIR, "amber-base.css"), "utf8") : "";
const theme = (ios) => {
  const L = { bg: "#FFFEFD", surface: "#F4F1EE", fill: "#EBE6E1", text: "#2A1D10", sec: "#74604C", sep: "rgba(138, 74, 28, 0.14)", acc: "#D96A06", accT: "#A85700", soft: "#FFF1DC", on: "#FFFFFF", danger: "#C62828" };
  const Dk = { bg: ios ? "#000000" : "#1F1E1D", surface: ios ? "#1C1B1A" : "#2A2927", fill: ios ? "#2C2A28" : "#34322F", text: "#F6EFE7", sec: "#BCB0A3", sep: "rgba(255, 250, 245, 0.10)", acc: "#F4AD33", accT: "#F4AD33", soft: "#423014", on: "#1F1300", danger: "#FF6B5E" };
  const v = (c) => `--amber-bg:${c.bg};--amber-surface:${c.surface};--amber-fill:${c.fill};--amber-text:${c.text};--amber-text-secondary:${c.sec};--amber-separator:${c.sep};--amber-accent:${c.acc};--amber-accent-text:${c.accT};--amber-accent-soft:${c.soft};--amber-on-accent:${c.on};--amber-danger:${c.danger}`;
  return `:root{color-scheme:light dark;${v(L)};--amber-radius:${ios ? 14 : 10}px;--amber-radius-small:${ios ? 10 : 6}px;--amber-content-max:1100px;--amber-gutter:clamp(16px,3.5vw,40px);--amber-font:-apple-system,system-ui,sans-serif;--amber-font-rounded:ui-rounded,-apple-system,system-ui,sans-serif;--amber-font-mono:ui-monospace,Menlo,monospace;--amber-safe-bottom:0px;--amber-inset-bottom:0px}
@media (prefers-color-scheme: dark){:root{${v(Dk)}}} html{font-size:${ios ? 17 : 14}px} body{margin:0;background:var(--amber-bg);color:var(--amber-text);font:1rem/1.35 var(--amber-font)}`;
};
const shim = fs.readFileSync(new URL("./shim.js", import.meta.url), "utf8");
const probe = () => { const W = innerWidth, hits = [];
  for (const el of document.querySelectorAll("body *")) { const r = el.getBoundingClientRect(); if (!r.width || r.right <= W + 1 && r.left >= -1) continue;
    let p = el.parentElement, ok = false; while (p && p !== document.body) { const s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) { const q = p.getBoundingClientRect(); if (q.right <= W + 1 && q.left >= -1) { ok = true; break; } } p = p.parentElement; }
    if (!ok && getComputedStyle(el).visibility !== "hidden") hits.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} [${Math.round(r.left)}..${Math.round(r.right)}]`); }
  for (const el of document.querySelectorAll("body *")) { const s = getComputedStyle(el); if (/(hidden|clip)/.test(s.overflowX) && s.textOverflow !== "ellipsis" && !el.classList.contains("sr") && el.scrollWidth > el.clientWidth + 2 && !/^(CANVAS|IMG|svg)$/i.test(el.tagName)) hits.push(`clipped ${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} by ${el.scrollWidth - el.clientWidth}px`); }
  return hits.slice(0, 5); };
const browser = await webkit.launch();
for (const mode of opt("--only", "phone-light,phone-dark,wide-light,wide-dark").split(",")) {
  const [size, scheme] = mode.split("-"), ios = size !== "wide";
  const vp = { phone: { width: 390, height: 844 }, small: { width: 320, height: 640 }, wide: { width: 1440, height: 900 } }[size];
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, colorScheme: scheme });
  const p = await ctx.newPage(), errors = [];
  p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  const boot = `window.__amberLab=${JSON.stringify({ body, data, today })};window.AudioContext=window.webkitAudioContext=class{constructor(){throw new Error("muted in the lab")}};`;
  await p.setContent(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><script>${boot}\n${shim}</script><style>${theme(ios)}</style><style>@layer amber-base{${base}}</style>${libs}` + html.replace(/^\s*<!doctype[^>]*>/i, ""), { waitUntil: "load" });
  await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(out, `${mode}.png`) });
  const steps = [];
  if (args.includes("--scenario") && fs.existsSync(path.join(dir, "lab-scenario.mjs"))) {
    const mod = await import(pathToFileURL(path.join(dir, "lab-scenario.mjs")).href + "?" + Date.now());
    await mod.default(p, { wide: size === "wide", shot: async (n) => { await p.screenshot({ path: path.join(out, `${mode}-${n}.png`) }); const o = await p.evaluate(probe); steps.push(o.length ? `${n}: OVERFLOW ${o.join(", ")}` : n); } });
    fs.writeFileSync(path.join(out, "after.md"), await p.evaluate(() => window.amber._body));
    fs.writeFileSync(path.join(out, "log.json"), JSON.stringify(await p.evaluate(() => window.__amberLog), null, 1));
  }
  const o = await p.evaluate(probe);
  console.log(mode, "errors:", errors.length ? errors.slice(0, 4) : 0, "overflow:", o.length ? o : 0, steps.length ? steps.filter((s) => /OVERFLOW/.test(s)).join(" | ") || `${steps.length} steps ok` : "");
  await ctx.close();
}
await browser.close();
console.log(out);
