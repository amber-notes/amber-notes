// A contact sheet of a round's apps, to judge their range at a glance: the phone screenshot (top
// part) of every app task, labelled, in a grid.
//   deno run -A scripts/page-evals/contact-sheet.ts <round> [variant=sonnet] [out.png] [--desktop]
import { webkit } from "npm:playwright-core@1.63.0";

const [round, variant = "sonnet", out = `contact-${round}-${variant}.png`] = Deno.args.filter((a) => !a.startsWith("--"));
const desktop = Deno.args.includes("--desktop");
const shots = new URL(`results/${round}/shots/`, import.meta.url);
const files = [...Deno.readDirSync(shots)].map((e) => e.name)
  .filter((n) => (desktop ? n.endsWith("-1280-light.png") : /-(375|390)-light\.png$/.test(n)) && n.includes(`-${variant}-`) && !n.includes(`-${variant}-no-`))
  .sort();
if (!files.length) throw new Error(`No screenshots for ${variant} in ${round}.`);
const toData = (n: string) => `data:image/png;base64,${btoa(Array.from(Deno.readFileSync(new URL(n, shots)), (b) => String.fromCharCode(b)).join(""))}`;
const cell = desktop ? 420 : 220;
const html = `<!doctype html><html><body style="margin:0;background:#1d1a16;font:13px -apple-system,system-ui,sans-serif;color:#f3eee8">
<div style="padding:16px 18px 6px;font-size:18px;font-weight:600">${round} · ${variant} · ${files.length} apps (${desktop ? "1280 px" : "375 px"}, light)</div>
<div style="display:grid;grid-template-columns:repeat(${desktop ? 4 : 7},${cell}px);gap:14px;padding:12px 18px 18px">
${files.map((n) => `<figure style="margin:0"><div style="height:${desktop ? 300 : 420}px;overflow:hidden;border-radius:10px;background:#fff"><img src="${toData(n)}" style="width:100%;display:block"></div>
<figcaption style="padding-top:6px;opacity:.85">${n.replace(/-(375|390|1280)-light\.png$/, "").replace(`-${variant}`, "")}</figcaption></figure>`).join("")}
</div></body></html>`;
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: desktop ? 4 * (cell + 14) + 36 : 7 * (cell + 14) + 36, height: 600 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "load" });
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(out);
