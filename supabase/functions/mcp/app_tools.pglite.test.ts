// check_app and preview_app against a local render service (scripts/page-render/server.ts, headless
// WebKit), and the sample a note's app is rendered over.
//   cd supabase/functions/mcp && deno test -A app_tools.pglite.test.ts
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { sampleData, sampleNote } from "./app_sample.ts";
import { networkReport } from "./app_check.ts";
import { libraryReport } from "./libraries.ts";
import { findTables } from "./notes.ts";
import { schemaDB } from "./pglite.ts";
import { type Account, account, app, note, toolContext } from "./sealed.ts";
import { Content, runTool } from "./tools.ts";

// deno-lint-ignore no-explicit-any
const tool = async (pg: PGlite, a: Account, name: string, args: Record<string, unknown> = {}, write = true) => await runTool(name, args, await toolContext(pg, a, write)) as any;
const BODY = "Lisbon budget\n\nSpent in Lisbon with Ana.\n\n## Costs\n| Date | Item | Category | Amount |\n| --- | --- | --- | --- |\n| 2026-10-01 | Hotel Avenida | Stay | 1 450 |\n| 2026-10-02 | Pastéis | Food | 12,50 |\n| 2026-10-02 | Tram 28 | Transport | 3 |\n\n- [x] Book flights\n- [ ] Pay Ana back\n";

Deno.test("the sample keeps the note's shape and none of its words", () => {
  const s = sampleNote(BODY, "2026-10-05");
  for (const word of ["Lisbon", "Ana", "Avenida", "Pastéis", "Tram", "flights"]) assert(!s.includes(word), word);
  const [t] = findTables(s);
  assertEquals(t.columns.map((c) => c.name), ["Date", "Item", "Category", "Amount"]);
  assertEquals(t.rows.length, 3);
  assert(/^2026-10-\d\d$/.test(t.rows[0][0]) && /^\d[\d ]*$/.test(t.rows[0][3]) && /,\d\d$/.test(t.rows[1][3]));
  assertEquals(t.rows[1][2] === t.rows[2][2], false);
  assert(s.includes("- [x] Item") && s.includes("- [ ] Item"));
  const d = sampleData({ values: { goal: 12000, city: "Lisbon" }, collections: { trips: [{ id: "t1", created: "2026-10-01T00:00:00Z", who: "Ana", photo: { $file: "abc" } }] } }, "2026-10-05") as any;
  assertEquals([d.collections.trips[0].id, typeof d.values.goal], ["t1", "number"]);
  assert(!JSON.stringify(d).includes("Lisbon") && !JSON.stringify(d).includes("Ana") && !JSON.stringify(d).includes("abc"));
});

Deno.test("network and keys: declared vs used vs set up, and keys pasted into the app", () => {
  const html = `<meta name="amber-needs" content='{"hosts": ["api.open-meteo.com"], "keys": [{"name": "OpenWeather", "hosts": ["api.openweathermap.org"], "query": "appid={key}"}]}'><script>amber.fetch("https://api.openweathermap.org/data/2.5/weather?q=Porto", { key: "OpenWeather" }); amber.fetch("https://evil.example/x"); const k = "3f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c";</script>`;
  const r = networkReport(html, [{ name: "OpenWeather", hosts: ["api.openweathermap.org"], set: false }]).join("\n");
  assertStringIncludes(r, "evil.example, which amber-needs doesn't declare");
  assertStringIncludes(r, "declares api.open-meteo.com but nothing calls it");
  assertStringIncludes(r, "has no value yet");
  assertStringIncludes(r, "looks like an API key");
  assertStringIncludes(networkReport(html, []).join(), "isn't in Settings › API Keys yet");
});

Deno.test("libraries: pasted copies, unpinned or unhashed npm references and unknown names are flagged", () => {
  const pasted = `<script>/*! Chart.js v4.4.4 | https://www.chartjs.org */${"x".repeat(6000)}</script><script>amber.onChange(() => {})</script>`;
  assertStringIncludes(libraryReport(pasted).join(), "pasted copy of chart.js");
  assertStringIncludes(libraryReport(`<script>${"y".repeat(70000)}</script>`).join(), "looks like a pasted library");
  assertStringIncludes(libraryReport(`<script src="amber-lib:npm/qrcode-generator@^2/dist/qrcode.js"></script>`).join(), "pin an exact version");
  assertStringIncludes(libraryReport(`<script src="amber-lib:npm/qrcode-generator@2.0.4/dist/qrcode.js"></script>`).join(), "no integrity hash");
  assertEquals(libraryReport(`<script src="amber-lib:npm/qrcode-generator@2.0.4/dist/qrcode.js" integrity="sha256-eeyG+ChWAFsciHkFz8z8++w4Icphx/1alS+qX3ePeRw="></script><script src="amber-lib:chart.js"></script>`), []);
  assertEquals(libraryReport(`<script type="importmap">{"imports": {"three": "amber-lib:three"}}</script>`), []);
  assertStringIncludes(libraryReport(`<script src="amber-lib:leaflet"></script>`).join(), "isn't a bundled library");
});

Deno.test("check_app and preview_app render a sample through the render service", async () => {
  Deno.env.set("RENDER_SECRET", "test-secret");
  const { handle } = await import("../../../scripts/page-render/server.ts");
  const { closeBrowser } = await import("../../../scripts/page-render/render.ts");
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, handle);
  Deno.env.set("RENDER_URL", `http://127.0.0.1:${server.addr.port}`);
  try {
    const pg = await schemaDB();
    const a = await account(pg);
    const id = await note(pg, a, BODY);
    const bad = `<!doctype html><html><body style="background:#fff"><main id="m" style="width:900px"></main><input placeholder="amount"><script>amber.onChange((n) => { m.innerHTML = n.tables[0].rows.map((r) => "<p style='font-size:9px'>" + r[1] + "</p>").join(""); setTimeout(() => nope.x); })</script></body></html>`;
    await tool(pg, a, "set_note_page", { id, html: bad });
    const r = await tool(pg, a, "check_app", { id }, false);
    const all = r.issues.join("\n");
    assertEquals(r.ok, false);
    for (const want of ["script error", "wider than the screen", "under 12 px", "without a label", "--amber-*", "ran as HTML"]) assertStringIncludes(all, want);
    // The render service got a sample, not the note.
    assert(!all.includes("Hotel Avenida") && !all.includes("Pastéis"));

    const good = `<!doctype html><html lang="en"><body><main id="m" style="max-width:var(--amber-content-max);margin:0 auto;padding:16px var(--amber-gutter)"></main><script>const esc=(s)=>String(s).replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);amber.onChange((n) => { const t = n.tables[0]; m.innerHTML = "<h1>" + esc(n.title) + "</h1>" + (t ? t.rows.map((r) => "<p style='background:var(--amber-surface);color:var(--amber-text)'>" + esc(r[1]) + "</p>").join("") : "<p>No rows yet.</p>"); })</script></body></html>`;
    await tool(pg, a, "set_note_page", { id, html: good });
    assertEquals((await tool(pg, a, "check_app", { id }, false)).issues, []);
    const p = await tool(pg, a, "preview_app", { id, widths: [390], themes: ["light", "dark"] }, false);
    assert(p instanceof Content);
    const images = p.content.filter((b: Record<string, unknown>) => b.type === "image");
    assertEquals(images.length, 2);
    assert(atob(images[0].data as string).startsWith("\x89PNG"));
    assertStringIncludes(p.content[0].text as string, "Sample note");
    assertStringIncludes(await tool(pg, a, "preview_app", { id, data: "real" }, false).catch((e) => String(e)), "Previews with real data are off");
    await app(pg, a.id, `insert into public.profiles (user_id, app_previews_real) values ($1, true) on conflict (user_id) do update set app_previews_real = true`, [a.id]);
    const real = await tool(pg, a, "preview_app", { id, widths: [390], themes: ["light"], data: "real" }, false);
    assertStringIncludes(real.content[0].text as string, "Hotel Avenida");
  } finally {
    await server.shutdown();
    await closeBrowser();
  }
});
