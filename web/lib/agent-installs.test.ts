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

  it("the manifests say Pinto Notes, and keep the ids that installs depend on", () => {
    const plugin = repo("plugins/amber-notes/.claude-plugin/plugin.json");
    expect(plugin.name).toBe("amber-notes");
    expect(plugin.displayName).toBe("Pinto Notes");
    expect(repo(".claude-plugin/marketplace.json").name).toBe("amber-notes");
    expect(repo("gemini-extension.json").name).toBe("amber-notes");
    for (const file of ["plugins/amber-notes/.claude-plugin/plugin.json", ".claude-plugin/marketplace.json", "gemini-extension.json"]) {
      expect(JSON.stringify(repo(file)), file).toContain("Pinto Notes");
    }
  });
});

describe("MCP Registry entries in the repo", () => {
  it("the live entry keeps its name and address, and says Pinto Notes", () => {
    const live = repo("server.json");
    expect(live.name).toBe("app.ambernotes/amber-notes");
    expect(live.title).toBe("Pinto Notes");
    expect(live.remotes).toEqual([{ type: "streamable-http", url: MCP_URL }]);
    expect(live.description.length).toBeLessThanOrEqual(100);
  });

  it("the entry for the new name is on pintonotes.com, at an address of its own", () => {
    const next = repo("server.pintonotes.json");
    expect(next.name).toBe("com.pintonotes/pinto-notes");
    expect(next.title).toBe("Pinto Notes");
    // The registry lets one address belong to one name only, so the new entry can't reuse the old one.
    expect(next.remotes).toEqual([{ type: "streamable-http", url: "https://mcp.pintonotes.com" }]);
    expect(next.description.length).toBeLessThanOrEqual(100);
    expect(next.repository).toEqual(repo("server.json").repository);
  });

  it("pintonotes.com proves the com.pintonotes namespace with the same public key as ambernotes.app's DNS record", () => {
    const proof = readFileSync(new URL("../public/.well-known/mcp-registry-auth", import.meta.url), "utf8");
    expect(proof).toBe("v=MCPv1; k=ed25519; p=83sv2tQ57ePV8lfoNuavy9f4EWnip4oODqTR6obHO7g=\n");
  });
});
