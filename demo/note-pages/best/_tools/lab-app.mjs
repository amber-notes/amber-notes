// The WebKit lab for a note app made of files (a project): compiles it the way the AI tooling does
// (scripts/build-app.ts), serves its files and the bundled modules over a stand-in origin with the
// same import map as Amber Notes, with the bridge stand-in (shim.js). Muted. Reports errors and
// anything wider than the window, like lab.mjs.
//   node lab-app.mjs <appdir: holds app/ and data.json> [--out dir] [--only phone-light,...] [--scenario]
import { webkit } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2), dir = path.resolve(args[0]);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const repo = path.resolve(dir, "../../../..");
const out = path.resolve(opt("--out", path.join(repo, ".shots", "lab", path.basename(dir))));
fs.mkdirSync(out, { recursive: true });
const built = path.join(dir, "app.json");
execFileSync("deno", ["run", "-A", "--no-config", "scripts/build-app.ts", "project", path.join(dir, "app"), built], { cwd: repo, stdio: ["ignore", "ignore", "inherit"] });
const project = JSON.parse(fs.readFileSync(built, "utf8"));
const LIB = path.join(repo, "Pane/Resources/AppLibraries");
const MODULES = { preact: "preact.module.js", "preact-hooks": "preact-hooks.module.js", "preact-jsx-runtime": "preact-jsx-runtime.module.js", htm: "htm.module.js", "amber-router": "amber-router.module.js", amber: "amber.module.js" };
const kit = JSON.parse(fs.readFileSync(path.join(LIB, "amber-ui.json"), "utf8"));
const map = { imports: { preact: "http://lib.lab/esm/preact.js", "preact/hooks": "http://lib.lab/esm/preact-hooks.js", "preact/jsx-runtime": "http://lib.lab/esm/preact-jsx-runtime.js",
  htm: "http://lib.lab/esm/htm.js", "amber-router": "http://lib.lab/esm/amber-router.js", amber: "http://lib.lab/esm/amber.js", "amber-ui": "http://lib.lab/amber-ui/index.js", "@/": "http://app.lab/src/" } };
// The app stack (React as preact/compat and the libraries on it), after the rest, as the host does.
const stack = fs.existsSync(path.join(LIB, "stack.json")) ? JSON.parse(fs.readFileSync(path.join(LIB, "stack.json"), "utf8")) : { map: {}, modules: {} };
for (const [name, file] of Object.entries(stack.map)) map.imports[name] = "http://lib.lab/stack/" + file;
// Like NotePageProject.resolve: an import without an extension finds the file the way bundlers do.
const resolve = (p) => [p, ...[".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"].map((e) => p + e)].find((x) => project.files[x] != null);
const today = new Date().toLocaleDateString("sv-SE");
// {{d-3}} and {{t-3@08:15}} in the demo data are days and times relative to today, as the seeder reads them.
const shift = (n) => { const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const tokens = (s) => s.replace(/\{\{d([+-]\d+)?\}\}/g, (_, n) => shift(+(n || 0))).replace(/\{\{t([+-]\d+)?(?:@(\d\d):(\d\d))?\}\}/g, (_, n, h, m) => new Date(`${shift(+(n || 0))}T${h || "12"}:${m || "00"}:00`).toISOString());
const data = fs.existsSync(path.join(dir, "data.json")) ? JSON.parse(tokens(fs.readFileSync(path.join(dir, "data.json"), "utf8"))) : { values: {}, collections: {} };
const shim = fs.readFileSync(new URL("./shim.js", import.meta.url), "utf8");
const base = fs.existsSync(path.join(LIB, "amber-base.css")) ? fs.readFileSync(path.join(LIB, "amber-base.css"), "utf8") : "";
// Amber's tokens as the host gives them (amber-tokens.css), light and dark, and the device's text size.
const theme = (ios) => {
  const L = { bg: "#FFFEFD", surface: "#F4F1EE", fill: "#EBE6E1", text: "#2A1D10", sec: "#74604C", sep: "rgba(138, 74, 28, 0.14)", acc: "#D96A06", accT: "#A85700", soft: "#FFF1DC", on: "#FFFFFF", danger: "#C62828", field: "#9A8673" };
  const Dk = { bg: ios ? "#000000" : "#1F1E1D", surface: ios ? "#1C1B1A" : "#2A2927", fill: ios ? "#2C2A28" : "#34322F", text: "#F6EFE7", sec: "#BCB0A3", sep: "rgba(255, 250, 245, 0.10)", acc: "#F4AD33", accT: "#F4AD33", soft: "#423014", on: "#1F1300", danger: "#FF6B5E", field: "#7A716A" };
  const v = (c) => `--amber-bg:${c.bg};--amber-surface:${c.surface};--amber-fill:${c.fill};--amber-text:${c.text};--amber-text-secondary:${c.sec};--amber-separator:${c.sep};--amber-accent:${c.acc};--amber-accent-text:${c.accT};--amber-accent-soft:${c.soft};--amber-on-accent:${c.on};--amber-danger:${c.danger};--amber-field-border:${c.field}`;
  return `@layer amber-tokens{:root{color-scheme:light dark;${v(L)};--amber-root-font:${ios ? "17px/1.35 -apple-system, system-ui, sans-serif" : "14px/1.35 -apple-system, system-ui, sans-serif"};--amber-font:-apple-system,system-ui,sans-serif;--amber-radius:${ios ? 14 : 10}px;--amber-radius-small:${ios ? 10 : 6}px;--amber-safe-top:0px;--amber-safe-bottom:${ios ? "34px" : "0px"};--amber-inset-bottom:0px;--amber-gutter:clamp(16px,3.5vw,40px)}
@media (prefers-color-scheme: dark){:root{${v(Dk)}}}} html{font:var(--amber-root-font)}`;
};
const probe = () => { const W = innerWidth, hits = [];
  for (const el of document.querySelectorAll("body *")) { const r = el.getBoundingClientRect(); if (!r.width || r.right <= W + 1 && r.left >= -1) continue;
    let p = el.parentElement, ok = false; while (p && p !== document.body) { const s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) { const q = p.getBoundingClientRect(); if (q.right <= W + 1 && q.left >= -1) { ok = true; break; } } p = p.parentElement; }
    if (!ok) hits.push(`${el.tagName.toLowerCase()}.${String(el.className.baseVal ?? el.className).split(" ")[0]} [${Math.round(r.left)}..${Math.round(r.right)}]`); }
  for (const el of document.querySelectorAll("body *")) { const s = getComputedStyle(el); if (/(hidden|clip)/.test(s.overflowX) && s.textOverflow !== "ellipsis" && el.scrollWidth > el.clientWidth + 2 && !/^(CANVAS|IMG|svg|TEXTAREA|INPUT)$/i.test(el.tagName) && el.tagName !== "BODY" && el.tagName !== "HTML" && !el.classList.contains("sr-only")) hits.push(`clipped ${el.tagName.toLowerCase()}.${String(el.className.baseVal ?? el.className).split(" ")[0]} by ${el.scrollWidth - el.clientWidth}px`); }
  return hits.slice(0, 5); };

const browser = await webkit.launch();
for (const mode of opt("--only", "phone-light,phone-dark,small-light,wide-light,wide-dark").split(",")) {
  const [size, scheme] = mode.split("-"), ios = size !== "wide";
  const vp = { phone: { width: 393, height: 852 }, small: { width: 320, height: 640 }, wide: { width: 1280, height: 860 } }[size];
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: ios ? 3 : 2, colorScheme: scheme });
  await ctx.route("http://lib.lab/**", (r) => {
    const p = new URL(r.request().url()).pathname;
    if (p.startsWith("/stack/")) { const js = stack.modules[p.slice(7)]; return js ? r.fulfill({ contentType: "text/javascript", body: js, headers: { "access-control-allow-origin": "*" } }) : r.fulfill({ status: 404 }); }
    if (p.startsWith("/esm/")) return r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(LIB, MODULES[p.slice(5, -3)])), headers: { "access-control-allow-origin": "*" } });
    const key = p.replace("/amber-ui/", ""); const js = kit.compiled[key === "index.js" ? "index.jsx" : key];
    return js ? r.fulfill({ contentType: "text/javascript", body: js, headers: { "access-control-allow-origin": "*" } }) : r.fulfill({ status: 404 });
  });
  await ctx.route("http://app.lab/**", (r) => {
    const p = new URL(r.request().url()).pathname;
    if (p === "/index.html") {
      const noBase = /<meta[^>]*name=["']amber-base["'][^>]*content=["']none["']/i.test(project.files["/index.html"]);
      const head = `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>${theme(ios)}</style>${noBase ? "" : `<style>@layer amber-base{${base}}</style>`}<script type="importmap">${JSON.stringify(map)}</script>`
        + `<script>window.__amberLab=${JSON.stringify({ body: "# Evening\n", data, today })};window.AudioContext=window.webkitAudioContext=class{constructor(){throw new Error("muted in the lab")}};\n${shim}</script>`;
      return r.fulfill({ contentType: "text/html", body: head + project.files["/index.html"].replace(/^\s*<!doctype[^>]*>/i, "") });
    }
    const u = new URL(r.request().url()), f = resolve(u.pathname);
    if (!f) return r.fulfill({ status: 404 });
    if (u.search === "?import" && f.endsWith(".css")) return r.fulfill({ contentType: "text/javascript", body: `if (!document.querySelector('link[href="${f}"]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '${f}'; document.head.appendChild(l); }` });
    const body = /\.(jsx|tsx|ts|css)$/.test(f) ? project.compiled[f] ?? project.files[f] : project.files[f];
    return r.fulfill({ contentType: /\.css$/.test(f) ? "text/css" : "text/javascript", body });
  });
  const p = await ctx.newPage(), errors = [];
  p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await p.goto("http://app.lab/index.html"); await p.waitForTimeout(700);
  await p.screenshot({ path: path.join(out, `${mode}.png`) });
  const steps = [];
  if (args.includes("--scenario") && fs.existsSync(path.join(dir, "lab-scenario.mjs"))) {
    const mod = await import(pathToFileURL(path.join(dir, "lab-scenario.mjs")).href + "?" + Date.now());
    await mod.default(p, { wide: size === "wide", shot: async (n, full) => { await p.waitForTimeout(250); await p.screenshot({ path: path.join(out, `${mode}-${n}.png`), fullPage: !!full }); const o = await p.evaluate(probe); steps.push(o.length ? `${n}: OVERFLOW ${o.join(", ")}` : n); } });
    fs.writeFileSync(path.join(out, "log.json"), JSON.stringify(await p.evaluate(() => ({ log: window.__amberLog, data: window.amber.data })), null, 1));
  }
  const o = await p.evaluate(probe);
  console.log(mode, "errors:", errors.length ? errors.slice(0, 4) : 0, "overflow:", o.length ? o : 0, steps.length ? steps.filter((s) => /OVERFLOW/.test(s)).join(" | ") || `${steps.length} steps ok` : "");
  await ctx.close();
}
await browser.close();
console.log(out);
