// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { McpChooser } from "./McpChooser";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); act(() => root.render(<McpChooser />)); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const pick = (label: string) => act(() => {
  const b = [...host.querySelectorAll("button")].find((x) => x.textContent === label);
  if (!b) throw new Error(`no button ${label}`);
  b.click();
});
const verdict = () => host.querySelector('[aria-live="polite"]')?.textContent ?? "";

describe("which Apple Notes MCP setup works for you", () => {
  it("says nothing until they answer", () => {
    expect(verdict()).toBe("");
  });

  it("sends Claude Code and Codex to sweetrb's server and its commands", () => {
    pick("Claude Code or Codex");
    expect(verdict()).toContain("sweetrb/apple-notes-mcp");
    expect(host.querySelector('a[href="#set-it-up"]')).not.toBeNull();
  });

  it("starts the Claude desktop app with Anthropic's own extension", () => {
    pick("The Claude app on my Mac");
    expect(verdict()).toContain("Apple Notes extension");
  });

  it("is honest that no Apple Notes server reaches ChatGPT, the web or iPhone", () => {
    for (const where of ["ChatGPT", "Claude on iPhone or the web"]) {
      pick(where);
      expect(verdict()).toContain("No Apple Notes MCP server works there");
      expect(host.querySelector('a[href="#iphone-and-icloud"]')).not.toBeNull();
    }
  });

  it("counts each answer as blog_helper_used and nothing else", () => {
    const buttons = [...host.querySelectorAll("button")];
    expect(buttons.length).toBe(4);
    for (const b of buttons) expect(b.getAttribute("data-event")).toBe("blog_helper_used");
  });
});
