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

    // The app's data is JSON in its store (the sample keeps its shape).
    await tool(pg, a, "update_page_data", { id, values: { log: [{ Date: "2026-10-01", Exercise: "Squat", Kg: "80" }, { Date: "2026-10-03", Exercise: "Bench", Kg: "60" }] } });
    const made = await tool(pg, a, "create_app", { id });
    const paths = made.files.map((f: { path: string }) => f.path);
    for (const f of ["/README.md", "/index.html", "/package.json", "/tsconfig.json", "/src/main.tsx", "/src/App.tsx", "/src/index.css", "/src/lib/amber.ts", "/src/lib/utils.ts", "/src/components/app-shell.tsx", "/src/components/ui/button.tsx", "/src/components/ui/sheet.tsx", "/src/screens/home.tsx", "/src/screens/settings.tsx"]) assert(paths.includes(f), f);
    assertEquals(made.opens, "Opens cleanly at 390 and 1280 px (over a sample of its data).");
    assertStringIncludes(await fails(tool(pg, a, "create_app", { id })), "already has an app");

    const listed = await tool(pg, a, "list_app_files", { id }, false);
    assertStringIncludes(listed.readme, "# Training");
    const main = await tool(pg, a, "read_app_file", { id, path: "src/main.tsx" }, false);
    assertStringIncludes(main.content, "     1\timport { createRoot } from \"react-dom/client\"");

    // A list over the app's log, through a new component, the way it's done in any React app.
    await tool(pg, a, "write_app_file", { id, path: "/src/components/Entry.tsx", content: `import { Dumbbell } from "lucide-react";\nexport default function Entry({ row }: { row: { Exercise: string; Date: string; Kg: string } }) { return <li className="flex items-center gap-3 py-2"><Dumbbell className="size-4" /><span className="flex-1">{row.Exercise}</span><span className="text-muted-foreground">{row.Kg} kg</span></li>; }\n` });
    const edited = await tool(pg, a, "edit_app_file", {
      id, path: "/src/screens/home.tsx",
      old_string: `import { Sparkles } from "lucide-react"`,
      new_string: `import { Sparkles } from "lucide-react"\nimport { useStore } from "@/lib/amber"\nimport Entry from "@/components/Entry"`,
    });
    assertStringIncludes(JSON.stringify(edited), "saved");
    const r2 = await tool(pg, a, "edit_app_file", {
      id, path: "/src/screens/home.tsx",
      old_string: `          <Button>Get started</Button>`,
      new_string: `          <ul>{useStore("log", [] as { Exercise: string; Date: string; Kg: string }[])[0].map((r, i) => <Entry key={i} row={r} />)}</ul>`,
      look: true,
    });
    assert(r2 instanceof Content);
    const result = r2.structured as Record<string, unknown>;
    assertEquals(result.opens, "Opens cleanly at 390 and 1280 px (over a sample of its data).");
    assert(r2.content.some((b) => b.type === "image"));

    // Refused: a syntax error, CSS that doesn't compile, a network address. Errors: an import to nothing.
    assertStringIncludes(await fails(tool(pg, a, "write_app_file", { id, path: "/src/Bad.tsx", content: "export default () => <div>\n" })), "/src/Bad.tsx:2:");
    assertStringIncludes(await fails(tool(pg, a, "write_app_file", { id, path: "/src/x.ts", content: `fetch("https://evil.example/x")` })), "external addresses");
    assertStringIncludes(await fails(tool(pg, a, "edit_app_file", { id, path: "/src/index.css", old_string: `@import "tw-animate-css";`, new_string: `@import "tw-animate-css";\n.x { @apply not-a-class; }` })), "doesn't compile");
    const w = await tool(pg, a, "write_app_file", { id, path: "/src/Old.tsx", content: `import Gone from "./Gone";\nimport { useTable } from "amber";\nexport default () => <p>{useTable("Log").rows.length}{(window as any).amber.note.title}</p>;\n` });
    assertStringIncludes(w.errors.join("\n"), "./Gone");
    for (const want of ["window.amber", "keep data in the note"]) assertStringIncludes(w.notes.join("\n"), want);
    await tool(pg, a, "delete_app_file", { id, path: "/src/Old.tsx" });

    // A script error shows up as an error in the write's answer.
    const broken = await tool(pg, a, "edit_app_file", { id, path: "/src/components/Entry.tsx", old_string: "return <li", new_string: "(globalThis as any).nope.x; return <li" });
    assertStringIncludes(JSON.stringify(broken.errors), "nope");
    await tool(pg, a, "edit_app_file", { id, path: "/src/components/Entry.tsx", old_string: "(globalThis as any).nope.x; ", new_string: "" });

    // Moving a file breaks its importer until that's fixed.
    const moved = await tool(pg, a, "move_app_file", { id, from: "/src/components/Entry.tsx", to: "/src/components/LogEntry.tsx" });
    assertStringIncludes(moved.errors.join("\n"), "@/components/Entry");
    await tool(pg, a, "edit_app_file", { id, path: "/src/screens/home.tsx", old_string: "@/components/Entry", new_string: "@/components/LogEntry" });
    assertStringIncludes(await fails(tool(pg, a, "delete_app_file", { id, path: "/index.html" })), "can't be deleted");

    // Tests run on every save; try_app uses the app like a person, on a throwaway copy.
    const withTests = await tool(pg, a, "write_app_file", { id, path: "/tests/home.test.tsx", content: `import { it, expect } from "vitest"\nimport { render, screen } from "@testing-library/react"\nimport Home from "@/screens/home"\nit("lists the log", () => { render(<Home />); expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0) })\nit("is wrong on purpose", () => { render(<Home />); expect(screen.queryByText("No such thing")).toBeInTheDocument() })\n` });
    assertEquals(withTests.tests, "1 passed, 1 failed");
    assertStringIncludes(withTests.errors.join("\n"), "is wrong on purpose");
    assertEquals((await tool(pg, a, "run_app_tests", { id }, false)).passed, 1);
    const tried = await tool(pg, a, "try_app", { id, steps: [{ tap: "Settings" }, { type: "Ada", into: "Name" }, { tap: "Nowhere" }] }, false);
    assert(tried instanceof Content);
    const steps = (tried.structured as { steps: { failed?: string; data_changed?: string[]; screen: string[] }[] }).steps;
    assertEquals(steps.map((s) => !s.failed), [true, true, false]);
    assertStringIncludes(steps[1].data_changed!.join(), "settings");
    assertEquals(tried.content.filter((b) => b.type === "image").length, 1);
    await tool(pg, a, "delete_app_file", { id, path: "/tests/home.test.tsx" });

    // check_app knows projects; edit_note_page points to the file tools; get_note_page lists files.
    const checked = await tool(pg, a, "check_app", { id }, false);
    assertEquals([checked.ok, checked.errors], [true, []]);
    assertStringIncludes(await fails(tool(pg, a, "edit_note_page", { id, edits: [{ old_text: "a", new_text: "b" }] })), "edit_app_file");
    const page = await tool(pg, a, "get_note_page", { id }, false);
    assert(page.project && page.files.includes("/src/components/LogEntry.tsx"));

    // A whole session of writes is one version: the app before it (none here) and nothing between.
    const versions = await tool(pg, a, "get_note_page", { id }, false);
    assertEquals(versions.versions.length, 0);
  } finally {
    await closeBrowser();
    await server.shutdown();
  }
});
