// A note's app as a project of files (app_files.ts) in an in-process Postgres, opened through a
// local render service: scaffold, read, write, edit, move, delete, compile errors, the checks every
// write returns, and one version per session.
//   cd supabase/functions/mcp && deno test -A app_files.pglite.test.ts
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { schemaDB } from "./pglite.ts";
import { type Account, account, note, toolContext } from "./sealed.ts";
import { Content, runTool, ToolError } from "./tools.ts";

// deno-lint-ignore no-explicit-any
const tool = async (pg: PGlite, a: Account, name: string, args: Record<string, unknown> = {}, write = true) => await runTool(name, args, await toolContext(pg, a, write)) as any;
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { assert(e instanceof ToolError, String(e)); return (e as Error).message; } throw new Error("expected a ToolError"); };
const BODY = "Training\n\n## Log\n| Date | Exercise | Kg |\n| --- | --- | --- |\n| 2026-10-01 | Squat | 80 |\n| 2026-10-03 | Bench | 60 |\n";

Deno.test("a project app: scaffold, files, edits, compile errors, checks and versions", async () => {
  Deno.env.set("RENDER_SECRET", "test-secret");
  const { handle } = await import("../../../scripts/page-render/server.ts");
  const { closeBrowser } = await import("../../../scripts/page-render/render.ts");
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, handle);
  Deno.env.set("RENDER_URL", `http://127.0.0.1:${server.addr.port}`);
  try {
    const pg = await schemaDB();
    const a = await account(pg);
    const id = await note(pg, a, BODY);

    const made = await tool(pg, a, "create_app", { id });
    assertEquals(made.files.map((f: { path: string }) => f.path), ["/README.md", "/index.html", "/src/App.jsx", "/src/data.js", "/src/main.jsx", "/src/screens/Home.jsx", "/src/screens/Settings.jsx", "/src/styles.css"]);
    assertEquals(made.check, "Opens cleanly at 390 and 1280 px (over a sample note).");
    assertStringIncludes(await fails(tool(pg, a, "create_app", { id })), "already has an app");

    const listed = await tool(pg, a, "list_app_files", { id }, false);
    assertStringIncludes(listed.readme, "# Training");
    const home = await tool(pg, a, "read_app_file", { id, path: "src/screens/Home.jsx" }, false);
    assertStringIncludes(home.content, "     1\timport { useNote } from \"amber\";");

    // A screen over the note's Log table, by heading, through a new component.
    await tool(pg, a, "write_app_file", { id, path: "/src/components/Entry.jsx", content: `import { ListRow } from "amber-ui";\nexport default function Entry({ row }) { return <ListRow title={row.Exercise} subtitle={row.Date} trailing={row.Kg + " kg"} />; }\n` });
    const edited = await tool(pg, a, "edit_app_file", {
      id, path: "/src/screens/Home.jsx",
      old_string: `import { EmptyState } from "amber-ui";`,
      new_string: `import { useTable } from "amber";\nimport { EmptyState, List } from "amber-ui";\nimport Entry from "../components/Entry.jsx";`,
    });
    assertStringIncludes(JSON.stringify(edited), "saved");
    const r2 = await tool(pg, a, "edit_app_file", {
      id, path: "/src/screens/Home.jsx",
      old_string: `      <EmptyState title="Nothing here yet" body="This screen does the app's main job." />`,
      new_string: `      <List title="Log">{useTable("Log").rows.map((r) => <Entry row={r} />)}</List>`,
      look: true,
    });
    assert(r2 instanceof Content);
    const result = r2.structured as Record<string, unknown>;
    assertEquals(result.check, "Opens cleanly at 390 and 1280 px (over a sample note).");
    assert(r2.content.some((b) => b.type === "image"));

    // Refused: a syntax error, a network address; warned: a missing import, table by position, window.amber.
    assertStringIncludes(await fails(tool(pg, a, "write_app_file", { id, path: "/src/screens/Bad.jsx", content: "export default () => <div>\n" })), "/src/screens/Bad.jsx:2:");
    assertStringIncludes(await fails(tool(pg, a, "write_app_file", { id, path: "/src/x.js", content: `fetch("https://evil.example/x")` })), "external addresses");
    const w = await tool(pg, a, "write_app_file", { id, path: "/src/screens/Old.jsx", content: `import Gone from "./Gone.jsx";\nexport default () => <p>{window.amber.note.tables[0].rows.length}</p>;\n` });
    const warned = w.warnings.join("\n");
    for (const want of ["./Gone.jsx", "window.amber", "by position"]) assertStringIncludes(warned, want);
    await tool(pg, a, "delete_app_file", { id, path: "/src/screens/Old.jsx" });

    // A script error shows up in the write's check.
    const broken = await tool(pg, a, "edit_app_file", { id, path: "/src/components/Entry.jsx", old_string: "return <ListRow", new_string: "nope.x; return <ListRow" });
    assertStringIncludes(JSON.stringify(broken.check), "nope");
    await tool(pg, a, "edit_app_file", { id, path: "/src/components/Entry.jsx", old_string: "nope.x; ", new_string: "" });

    // Moving a file breaks its importer until that's fixed.
    const moved = await tool(pg, a, "move_app_file", { id, from: "/src/components/Entry.jsx", to: "/src/components/LogEntry.jsx" });
    assertStringIncludes(moved.warnings.join("\n"), "../components/Entry.jsx");
    await tool(pg, a, "edit_app_file", { id, path: "/src/screens/Home.jsx", old_string: "../components/Entry.jsx", new_string: "../components/LogEntry.jsx" });
    assertStringIncludes(await fails(tool(pg, a, "delete_app_file", { id, path: "/index.html" })), "can't be deleted");

    // check_app knows projects; edit_note_page points to the file tools; get_note_page lists files.
    const checked = await tool(pg, a, "check_app", { id }, false);
    assertEquals([checked.ok, checked.issues], [true, []]);
    assertStringIncludes(await fails(tool(pg, a, "edit_note_page", { id, edits: [{ old_text: "a", new_text: "b" }] })), "edit_app_file");
    const page = await tool(pg, a, "get_note_page", { id }, false);
    assert(page.project && page.files.includes("/src/components/LogEntry.jsx"));

    // A whole session of writes is one version: the app before it (none here) and nothing between.
    const versions = await tool(pg, a, "get_note_page", { id }, false);
    assertEquals(versions.versions.length, 0);
  } finally {
    await closeBrowser();
    await server.shutdown();
  }
});
