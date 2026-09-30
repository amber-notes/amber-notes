import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENT_INSTALLS } from "./agent-installs";
import { MCP_URL } from "./facts";

const repo = (path: string) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));

describe("installs for AI tools", () => {
  it("every command adds the server", () => {
    for (const x of AGENT_INSTALLS.filter((x) => x.code && x.tool !== "Claude Code" && x.tool !== "Gemini CLI")) {
      expect(x.code).toContain(MCP_URL);
    }
    expect(AGENT_INSTALLS.find((x) => x.tool === "Claude Code")!.alt!.code).toContain(MCP_URL);
  });

  it("Incredible, which has no command, gives steps and the address for older versions", () => {
    const x = AGENT_INSTALLS.find((x) => x.tool === "Incredible")!;
    expect(x.steps?.[0]).toBe("Open Apps and search for Amber Notes.");
    expect(x.signIn).toContain(MCP_URL);
  });

  it("VS Code's command carries the server as JSON", () => {
    const code = AGENT_INSTALLS.find((x) => x.tool === "VS Code")!.code!;
    expect(JSON.parse(code.slice(code.indexOf("'") + 1, code.lastIndexOf("'")))).toEqual({ name: "amber-notes", type: "http", url: MCP_URL });
  });
});

describe("plugin and extension manifests in the repo", () => {
  it("the Claude Code plugin and the Gemini CLI extension point at the server", () => {
    expect(repo("plugins/amber-notes/.mcp.json").mcpServers["amber-notes"]).toEqual({ type: "http", url: MCP_URL });
    expect(repo("gemini-extension.json").mcpServers["amber-notes"].httpUrl).toBe(MCP_URL);
    expect(repo(".claude-plugin/marketplace.json").plugins[0].source).toBe("./plugins/amber-notes");
  });
});
