import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MCP_TOOLS } from "./mcp-tools";

// The /guides/mcp-server page lists the server's tools; this keeps it from drifting from the server.
const source = readFileSync(new URL("../../supabase/functions/mcp/tools.ts", import.meta.url), "utf8");
const defined = [...source.slice(source.indexOf("export const tools"), source.indexOf("const writeTools"))
  .matchAll(/name: "(\w+)", title: "([^"]+)",\s*description: "((?:[^"\\]|\\.)*)"[\s\S]*?annotations: (\w+|\{[^}]*\})/g)]
  .map(([, name, title, description, a]) => ({
    name, title, description: description.replace(/\\"/g, '"'),
    kind: a === "read" ? "read" : a.includes("destructiveHint: true") ? "destructive" : "write",
  }));

describe("MCP tool list on the site", () => {
  it("names every tool the server defines, in the same order, with its title, description and kind", () => {
    expect(defined.length).toBeGreaterThan(20);
    expect(MCP_TOOLS).toEqual(defined);
  });
});
