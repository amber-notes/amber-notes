// Side by side: what a CLI builds unconstrained (baseline.ts) next to what it builds through
// Amber's MCP tools (run.ts), each at 390 px light and dark and at 1440 px.
//   deno run -A scripts/page-evals/compare-sheet.ts out.png "Claude Code, empty folder=<baseline dir>" "Claude via Amber=amber:<round>/<stem>" ...
// A baseline dir holds shot-390-light.png, shot-390-dark.png and shot-1440-light.png; an amber entry
// is rendered here from the saved page, note and data, the way the app shows it.
import { webkit } from "npm:playwright-core@1.63.0";
import { closeBrowser, renderPage } from "../page-render/render.ts";

const [out, ...entries] = Deno.args;
const results = new URL("results/", import.meta.url).pathname;
const toData = (p: string) => `data:image/png;base64,${btoa(Array.from(Deno.readFileSync(p), (b) => String.fromCharCode(b)).join(""))}`;
const exists = (p: string) => { try { Deno.statSync(p); return true; } catch { return false; } };

const columns: { label: string; shots: (string | null)[] }[] = [];
for (const e of entries) {
  const [label, src] = [e.slice(0, e.indexOf("=")), e.slice(e.indexOf("=") + 1)];
  if (src.startsWith("amber:")) {
    const base = `${results}${src.slice(6)}`;
    const html = Deno.readTextFileSync(`${base}.page.html`), md = Deno.readTextFileSync(`${base}.note.md`);
    const data = JSON.parse(Deno.readTextFileSync(`${base}.json`)).data ?? { values: {}, collections: {} };
    const prefix = `${base}.compare`;
    await renderPage(html, md, data, { today: "2026-10-05", shots: prefix, probes: false,
      views: [{ width: 390, scheme: "light" }, { width: 390, scheme: "dark" }, { width: 1440, scheme: "light" }] });
    columns.push({ label, shots: [`${prefix}-390-light.png`, `${prefix}-390-dark.png`, `${prefix}-1440-light.png`] });
  } else {
    columns.push({ label, shots: ["390-light", "390-dark", "1440-light"].map((v) => `${src}/shot-${v}.png`) });
  }
}
await closeBrowser();

const img = (p: string | null, h: number) => p && exists(p)
  ? `<div style="height:${h}px;overflow:hidden;border-radius:10px;background:#fff"><img src="${toData(p)}" style="width:100%;display:block"></div>`
  : `<div style="height:${h}px;border-radius:10px;background:#333;display:grid;place-items:center;opacity:.6">no screenshot</div>`;
const html = `<!doctype html><html><body style="margin:0;background:#1d1a16;font:14px -apple-system,system-ui,sans-serif;color:#f3eee8">
<div style="display:grid;grid-template-columns:repeat(${columns.length},760px);gap:24px;padding:20px">
${columns.map((c) => `<section><h2 style="font-size:20px;margin:0 0 10px">${c.label}</h2>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${img(c.shots[0], 760)}${img(c.shots[1], 760)}</div>
<div style="margin-top:10px">${img(c.shots[2], 460)}</div></section>`).join("")}
</div></body></html>`;
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: columns.length * 784 + 20, height: 900 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "load" });
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(out);
