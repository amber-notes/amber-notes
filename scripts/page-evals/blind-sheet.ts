// A blind side-by-side of an experiment round: per task, every run's app at 390 px and 1280 px,
// labelled A, B, C… in a shuffled order. Which label is which arm goes to a separate key file.
//   deno run -A scripts/page-evals/blind-sheet.ts <round> <out dir>
import { webkit } from "npm:playwright-core@1.63.0";
import { closeBrowser, renderPage } from "../page-render/render.ts";

const [round, outDir] = Deno.args;
const dir = new URL(`results/${round}/`, import.meta.url).pathname;
await Deno.mkdir(outDir, { recursive: true });
const runs = [...Deno.readDirSync(dir)].filter((e) => e.name.endsWith(".json")).map((e) => ({ stem: e.name.slice(0, -5), r: JSON.parse(Deno.readTextFileSync(`${dir}${e.name}`)) }));
const byTask = new Map<string, typeof runs>();
for (const x of runs) byTask.set(x.r.task, [...(byTask.get(x.r.task) ?? []), x]);
const key: Record<string, Record<string, string>> = {};
const toData = (p: string) => `data:image/png;base64,${btoa(Array.from(Deno.readFileSync(p), (b) => String.fromCharCode(b)).join(""))}`;
const browser = await webkit.launch();
for (const [task, list] of byTask) {
  const shuffled = list.map((x) => ({ x, k: crypto.getRandomValues(new Uint32Array(1))[0] })).sort((a, b) => a.k - b.k).map((y) => y.x);
  const cells: string[] = [];
  key[task] = {};
  for (const [i, { stem, r }] of shuffled.entries()) {
    const label = String.fromCharCode(65 + i);
    key[task][label] = `${r.hidden?.length ? "without tools" : "with tools"} (${stem})`;
    const page = Deno.readTextFileSync(`${dir}${stem}.page.html`);
    if (!page) { cells.push(`<section><h2>${label}</h2><p>no app</p></section>`); continue; }
    const prefix = `${outDir}/${task}-${label}`;
    await renderPage(page, Deno.readTextFileSync(`${dir}${stem}.note.md`), r.data ?? {}, { today: "2026-10-05", shots: prefix, probes: false, views: [{ width: 390, scheme: "light" }, { width: 1280, scheme: "light" }] }).catch(() => null);
    const img = (p: string, h: number) => { try { return `<div style="height:${h}px;overflow:hidden;border-radius:10px;background:#fff"><img src="${toData(p)}" style="width:100%;display:block"></div>`; } catch { return `<div style="height:${h}px;background:#333;border-radius:10px"></div>`; } };
    cells.push(`<section><h2 style="font-size:28px;margin:0 0 8px">${label}</h2><div style="display:grid;grid-template-columns:300px 640px;gap:10px">${img(`${prefix}-390-light.png`, 640)}${img(`${prefix}-1280-light.png`, 400)}</div></section>`);
  }
  const html = `<!doctype html><html><body style="margin:0;background:#1d1a16;color:#f3eee8;font:14px -apple-system,system-ui,sans-serif"><h1 style="padding:16px 20px 0;margin:0">${task}</h1><div style="display:grid;grid-template-columns:repeat(2,960px);gap:24px;padding:20px">${cells.join("")}</div></body></html>`;
  const p = await browser.newPage({ viewport: { width: 2 * 984 + 20, height: 900 } });
  await p.setContent(html, { waitUntil: "load" });
  await p.screenshot({ path: `${outDir}/blind-${task}.png`, fullPage: true });
  await p.close();
}
await browser.close();
await closeBrowser();
await Deno.writeTextFile(`${outDir}/blind-key.json`, JSON.stringify(key, null, 2));
console.log(`${byTask.size} sheets in ${outDir}; key in blind-key.json`);
