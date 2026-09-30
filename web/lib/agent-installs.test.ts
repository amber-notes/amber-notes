import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENT_INSTALLS, CURSOR_LINK, GOOSE_LINK, VSCODE_LINK } from "./agent-installs";
import { MCP_URL } from "./facts";

const repo = (path: string) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));

describe("install links for AI tools", () => {
  it("Cursor's link carries the server as base64 JSON", () => {
    const url = new URL(CURSOR_LINK);
    expect(url.protocol).toBe("cursor:");
    expect(url.searchParams.get("name")).toBe("amber-notes");
    expect(JSON.parse(atob(url.searchParams.get("config")!))).toEqual({ url: MCP_URL });
  });

  it("VS Code's link carries the server as URL-encoded JSON", () => {
    expect(VSCODE_LINK.startsWith("vscode:mcp/install?")).toBe(true);
    expect(JSON.parse(decodeURIComponent(VSCODE_LINK.slice("vscode:mcp/install?".length))))
      .toEqual({ name: "amber-notes", type: "http", url: MCP_URL });
  });

  it("Goose's link is a streamable HTTP extension at the server", () => {
    const q = new URL(GOOSE_LINK).searchParams;
    expect(q.get("type")).toBe("streamable_http");
    expect(q.get("url")).toBe(MCP_URL);
    expect(q.get("id")).toBe("amber-notes");
    expect(q.get("name")).toBe("Amber Notes");
  });

  it("every config snippet is valid JSON naming the server", () => {
    for (const x of AGENT_INSTALLS.filter((x) => x.file)) {
      expect(JSON.stringify(JSON.parse(x.code))).toContain(MCP_URL);
    }
  });
});

describe("plugin and extension manifests in the repo", () => {
  it("the Claude Code plugin and the Gemini CLI extension point at the server", () => {
    expect(repo("plugins/amber-notes/.mcp.json").mcpServers["amber-notes"]).toEqual({ type: "http", url: MCP_URL });
    expect(repo("gemini-extension.json").mcpServers["amber-notes"].httpUrl).toBe(MCP_URL);
    expect(repo(".claude-plugin/marketplace.json").plugins[0].source).toBe("./plugins/amber-notes");
  });
});
