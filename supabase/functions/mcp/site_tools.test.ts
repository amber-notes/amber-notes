// The site's list of MCP tools (web/lib/mcp-tools.ts, shown on /blog/mcp-server) is what this
// server serves in production: the same tools in the same order, with their titles, descriptions
// and kinds. Run: deno test -A supabase/functions/mcp/site_tools.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { MCP_TOOLS } from "../../../web/lib/mcp-tools.ts";
import { PRODUCTION_TOOL_NAMES, servedTools, tools } from "./tools.ts";

Deno.test("the site lists exactly the tools production serves", () => {
  const served = servedTools("").map((t) => ({
    name: t.name, title: t.title, description: t.description,
    kind: t.annotations.readOnlyHint ? "read" : t.annotations.destructiveHint ? "destructive" : "write",
  }));
  const listed = MCP_TOOLS.map(({ name, title, description, kind }) => ({ name, title, description, kind }));
  assertEquals(listed, served, "web/lib/mcp-tools.ts differs from what supabase/functions/mcp serves");
});

Deno.test("production serves exactly the named tools; the rest only with AMBER_MCP_TOOLS=pages", () => {
  assertEquals(servedTools("").map((t) => t.name), [...PRODUCTION_TOOL_NAMES], "every production name is a defined tool, in order");
  assertEquals(servedTools("pages").length, tools.length);
});
