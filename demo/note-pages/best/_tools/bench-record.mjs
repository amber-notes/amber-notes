// Records Barwise (the plain Claude Code build) the way Lift was recorded: a routine started, sets
// checked, rest, an exercise added, finished, then history, an exercise and progress. Muted, headless.
import { webkit } from "playwright";
import fs from "node:fs";
const dir = process.argv[2], out = process.argv[3];
fs.mkdirSync(out, { recursive: true });
const b = await webkit.launch();
const mute = () => { window.AudioContext = window.webkitAudioContext = class { constructor() { throw new Error("muted"); } }; window.Notification = class { static permission = "denied"; static requestPermission() { return Promise.resolve("denied"); } }; HTMLMediaElement.prototype.play = function () { return Promise.resolve(); }; };
for (const scheme of ["light", "dark"]) for (const [name, vp] of [["phone", { width: 393, height: 852 }], ["wide", { width: 1440, height: 920 }]]) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, colorScheme: scheme });
  const p = await ctx.newPage(); await p.addInitScript(mute);
  await p.goto("file://" + dir + "/index.html#/train"); await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/${name}-${scheme}.png` }); await ctx.close();
}
const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, colorScheme: "light", recordVideo: { dir: out, size: { width: 393, height: 852 } } });
const p = await ctx.newPage(); await p.addInitScript(mute);
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const w = (ms) => p.waitForTimeout(ms);
await p.goto("file://" + dir + "/index.html#/train"); await w(1500);
await p.locator('[data-act="startRoutine"]').first().click(); await w(1200);
for (let k = 0; k < 6; k++) { const t = p.locator('[data-act="toggleDone"][aria-pressed="false"]').first(); if (await t.count()) { await t.click(); await w(900); } const s = p.locator('#restbar [data-act]').filter({ hasText: /skip/i }); if (k === 0) { await w(1500); await p.screenshot({ path: `${out}/use-1.png` }); } if (await s.count()) { await s.first().click(); await w(400); } }
await p.mouse.wheel(0, 500); await w(800);
await p.locator('[data-act="addExercises"]').first().click(); await w(900);
const q = p.locator('input[type=search], input[placeholder*="earch"]').last(); await q.fill("curl"); await w(700);
await p.locator('.sheet input[type=checkbox], [role=dialog] input[type=checkbox], [role=dialog] [aria-pressed="false"]').first().click().catch(() => {}); await w(700);
await p.getByRole("button", { name: /^add/i }).last().click().catch(() => {}); await w(1000);
await p.getByRole("button", { name: /finish/i }).first().click(); await w(900);
await w(600); await p.locator("[role=dialog] button, .sheet button, dialog button").filter({ hasText: /^\s*finish\s*$/i }).last().click().catch(() => {}); await w(2400);
await p.screenshot({ path: `${out}/use-2.png` }); await w(800);
for (const r of ["history", "exercises", "progress"]) { await p.goto("file://" + dir + `/index.html#/${r}`); await w(1600); if (r === "exercises") { await p.locator('a[href*="#/exercise/"]').first().click().catch(() => {}); await w(1600); } }
await w(800); await ctx.close();
const v = fs.readdirSync(out).filter((f) => f.endsWith(".webm")).map((f) => `${out}/${f}`)[0];
fs.renameSync(v, `${out}/raw.webm`);
await b.close();
console.log("errors:", errs.length ? errs : 0);
