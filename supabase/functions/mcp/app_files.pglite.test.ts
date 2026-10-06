// A note's app as a project of files (app_files.ts) in an in-process Postgres, opened through a
// local render service: the starter (with its tests), reading and editing files, compile errors,
// see-and-try, and the gate: a version that fails its tests or the smoke check is held back as a
// draft while the last passing one stays live.
//   cd supabase/functions/mcp && deno test -A app_files.pglite.test.ts
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { schemaDB } from "./pglite.ts";
import { type Account, account, note, toolContext } from "./sealed.ts";
import { Content, runTool, ToolError } from "./tools.ts";
import { parseStored } from "./app_project.ts";

// These tests use the prototype tools (servedTools serves them only with AMBER_MCP_TOOLS=pages).
Deno.env.set("AMBER_MCP_TOOLS", "pages");

// deno-lint-ignore no-explicit-any
const tool = async (pg: PGlite, a: Account, name: string, args: Record<string, unknown> = {}, write = true) => await runTool(name, args, await toolContext(pg, a, write)) as any;
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { assert(e instanceof ToolError, String(e)); return (e as Error).message; } throw new Error("expected a ToolError"); };

/** What devices run (page_ct) and what the AI is working on (draft_ct). */
async function boxes(pg: PGlite, a: Account, id: string) {
  const [row] = (await pg.query(`select page_ct, draft_ct, draft_problems from public.note_pages where note_id = $1`, [id])).rows as { page_ct: string | null; draft_ct: string | null; draft_problems: string | null }[];
  const open = async (b: string | null) => (b ? parseStored(await a.vault.openPage(id, b)) : null);
  return { live: await open(row.page_ct), draft: await open(row.draft_ct), why: row.draft_problems };
}

Deno.test("a project app: the starter and its tests, files, edits, the gate, see and try", async () => {
  Deno.env.set("RENDER_SECRET", "test-secret");
  const { handle } = await import("../../../scripts/page-render/server.ts");
  const { closeBrowser } = await import("../../../scripts/page-render/render.ts");
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, handle);
  Deno.env.set("RENDER_URL", `http://127.0.0.1:${server.addr.port}`);
  try {
    const pg = await schemaDB();
    const a = await account(pg);
    const id = await note(pg, a, "Groceries\n");

    // The starter ships with tests, like a Vite template with Vitest; they pass and it goes live.
    const made = await tool(pg, a, "create_app", { id });
    const paths = made.files.map((f: { path: string }) => f.path);
    for (const f of ["/README.md", "/index.html", "/package.json", "/src/App.tsx", "/src/screens/home.tsx", "/tests/app.test.tsx", "/src/components/ui/button.tsx"]) assert(paths.includes(f), f);
    assertEquals([made.tests, made.smoke?.startsWith("ok"), made.live.startsWith("Live")], ["2 passed, 0 failed", true, true]);
    assertStringIncludes(JSON.parse((await tool(pg, a, "read_app_file", { id, path: "/package.json" }, false)).content.replace(/^\s*\d+\t/gm, "")).scripts.test, "vitest");
    assertStringIncludes(await fails(tool(pg, a, "create_app", { id })), "already has an app");

    // A syntax error is refused outright.
    assertStringIncludes(await fails(tool(pg, a, "write_app_file", { id, path: "/src/Bad.tsx", content: "export default () => <div>\n" })), "/src/Bad.tsx:2:");

    const versions = async () => ((await pg.query(`select count(*)::int as n from public.note_page_versions where note_id = $1`, [id])).rows[0] as { n: number }).n;
    const versionsBefore = await versions();
    // A change that breaks a screen is held back: the person keeps the last good app; the AI works on the draft.
    const broken = await tool(pg, a, "edit_app_file", { id, path: "/src/screens/settings.tsx", old_string: "const [settings, update] = useSettings(DEFAULTS)", new_string: "const [settings, update] = useSettings(DEFAULTS)\n  if (settings) throw new Error(\"settings broke\")" });
    assertStringIncludes(broken.live, "Held back");
    assertStringIncludes(broken.errors.join("\n"), "settings broke");
    let b = await boxes(pg, a, id);
    assert(!b.live!.files["/src/screens/settings.tsx"].includes("settings broke") && b.draft!.files["/src/screens/settings.tsx"].includes("settings broke"));
    assertEquals(b.why, "smoke check at 390 px: script error after tapping a control\nsmoke check at 1280 px: script error after tapping a control");
    assertStringIncludes((await tool(pg, a, "read_app_file", { id, path: "/src/screens/settings.tsx" }, false)).content, "settings broke");
    // Held back: no new version, the live page untouched.
    assertEquals(await versions(), versionsBefore);
    // Fixed: live again, the draft gone.
    const fixed = await tool(pg, a, "edit_app_file", { id, path: "/src/screens/settings.tsx", old_string: "\n  if (settings) throw new Error(\"settings broke\")", new_string: "" });
    assertStringIncludes(fixed.live, "Live");
    b = await boxes(pg, a, id);
    assertEquals([b.draft, b.why], [null, null]);

    // A failing test holds a version back too.
    const red = await tool(pg, a, "edit_app_file", { id, path: "/tests/app.test.tsx", old_string: `toContain("Milk")`, new_string: `toContain("Cheese")` });
    assertEquals([red.tests, red.live.startsWith("Held back")], ["1 passed, 1 failed", true]);
    await tool(pg, a, "edit_app_file", { id, path: "/tests/app.test.tsx", old_string: `toContain("Cheese")`, new_string: `toContain("Milk")` });

    // Imports to nothing are errors, and hold the version back.
    const moved = await tool(pg, a, "move_app_file", { id, from: "/src/screens/settings.tsx", to: "/src/screens/preferences.tsx" });
    assertStringIncludes(moved.errors.join("\n"), "@/screens/settings");
    await tool(pg, a, "edit_app_file", { id, path: "/src/App.tsx", old_string: "@/screens/settings", new_string: "@/screens/preferences" });
    assertEquals((await boxes(pg, a, id)).draft, null);

    // try_app uses the app like a person, on a throwaway copy.
    const tried = await tool(pg, a, "try_app", { id, steps: [{ type: "Milk", into: "New item" }, { tap: "Add" }, { tap: "Nowhere" }] }, false);
    assert(tried instanceof Content);
    const steps = (tried.structured as { steps: { failed?: string; data_changed?: string[] }[] }).steps;
    assertEquals(steps.map((s) => !s.failed), [true, true, false]);
    assertStringIncludes(steps[1].data_changed!.join(), "items");
    assertEquals((await tool(pg, a, "run_app_tests", { id }, false)).passed, 2);
    assertStringIncludes(await fails(tool(pg, a, "delete_app_file", { id, path: "/index.html" })), "can't be deleted");
  } finally {
    await closeBrowser();
    await server.shutdown();
  }
});
