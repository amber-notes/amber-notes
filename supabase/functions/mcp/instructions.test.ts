// deno test --allow-all instructions.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { instructions } from "./server.ts";
import { PAGE_INSTRUCTIONS } from "./page_guide.ts";
import { servedTools } from "./tools.ts";

/** Tool names a text mentions: words with an underscore, as every tool is named. */
const named = (text: string) => [...new Set(text.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [])];

function withToolSet(set: string | undefined, run: () => void) {
  const before = Deno.env.get("AMBER_MCP_TOOLS");
  if (set === undefined) Deno.env.delete("AMBER_MCP_TOOLS");
  else Deno.env.set("AMBER_MCP_TOOLS", set);
  try {
    run();
  } finally {
    if (before === undefined) Deno.env.delete("AMBER_MCP_TOOLS");
    else Deno.env.set("AMBER_MCP_TOOLS", before);
  }
}

Deno.test("with AMBER_MCP_TOOLS unset, the instructions name no app tool", () => {
  withToolSet(undefined, () => {
    const served = servedTools().map((t) => t.name);
    const prototypes = servedTools("pages").map((t) => t.name).filter((n) => !served.includes(n));
    assert(prototypes.includes("create_app") && prototypes.includes("get_page_guide"));
    const text = instructions();
    assertEquals(prototypes.filter((n) => new RegExp(`\\b${n}\\b`).test(text)), []);
    assert(!text.includes(PAGE_INSTRUCTIONS) && !text.includes("Apps:"));
    // The rest is whole: the line before the app lines is followed by the line after them.
    assert(text.includes("(note_history / restore_revision).\nA note marked locked: true"));
  });
});

Deno.test("with AMBER_MCP_TOOLS=pages, the instructions teach the app tools", () => {
  withToolSet("pages", () => {
    const text = instructions();
    assert(text.includes(PAGE_INSTRUCTIONS));
    for (const n of ["create_app", "get_page_guide", "preview_app", "check_app"]) assert(text.includes(n), n);
  });
});

Deno.test("the instructions name a tool only if the server serves it", () => {
  for (const set of [undefined, "", "pages"]) {
    const served = servedTools(set).map((t) => t.name);
    assertEquals(named(instructions(set)).filter((n) => !served.includes(n)), [], `AMBER_MCP_TOOLS=${set}`);
  }
});
