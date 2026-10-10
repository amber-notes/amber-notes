import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ownTopBar, themeFor, themeScript } from "./theme";
import PROMPTS from "./try-prompts.json";

// The theme a page gets before first paint (themeScript, in <head>) and the one the site keeps
// in step while navigating (themeFor) are written twice; they have to agree on every address.
function scriptTheme(path: string): string | null {
  const document = { documentElement: { dataset: {} as Record<string, string> } };
  new Function("location", "document", themeScript)({ pathname: path }, document);
  return document.documentElement.dataset.theme ?? null;
}

describe("the page theme", () => {
  const paths = ["/", "/download", "/blog/mcp-server", "/templates/trip-plan", "/privacy", "/terms", "/privacy-security", "/connect", "/open/connect", "/open/template/trip-plan", "/open/copy/abc", "/help", "/support", "/changelog", "/n/abc", "/n/abc/def", "/report/abc", "/nothing-here", "/notes"];

  it("is the same in the head script and in themeFor", () => {
    for (const p of paths) expect(scriptTheme(p), p).toBe(themeFor(p));
  });

  it("leaves shared notes and the report form to the visitor's system", () => {
    expect(themeFor("/n/abc")).toBeNull();
    expect(themeFor("/n/abc/def")).toBeNull();
    expect(themeFor("/report/abc")).toBeNull();
  });

  it("gives /open/connect the cream of /connect, whose card it shows", () => {
    expect(themeFor("/open/connect")).toBe("cream");
    expect(themeFor("/connect")).toBe("cream");
  });

  it("treats an address the site doesn't have as a site page, so its 404 has the header and footer", () => {
    expect(themeFor("/nothing-here")).toBe("cream");
    expect(themeFor("/notes")).toBe("cream"); // starts with "n", isn't a shared note
  });

  it("keeps help, support and the changelog leaf brown", () => {
    for (const p of ["/help", "/support", "/changelog"]) expect(themeFor(p)).toBe("leaf");
  });
});

describe("pages with their own top bar", () => {
  const ids = PROMPTS.map((p) => p.id);

  it("are the connect, reset, unsubscribe and Ask Claude pages", () => {
    for (const p of ["/connect", "/connect/preview", "/open/connect", "/reset-password", "/unsubscribe", `/copy/${ids[0]}`]) expect(ownTopBar(p, ids), p).toBe(true);
    for (const p of ["/", "/help", "/unsubscribe/confirm", "/copy", "/copy/not-a-prompt", "/open/import", "/templates/trip-plan"]) expect(ownTopBar(p, ids), p).toBe(false);
  });

  // A page that draws TopBar inside the site's header shows two logos. Every page.tsx that draws one
  // must either be outside the site's chrome (themeFor is null) or be listed in ownTopBar.
  it("never sit under the site's header as well", () => {
    const app = join(__dirname, "../app");
    const pages: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = join(dir, name);
        if (statSync(file).isDirectory()) walk(file);
        else if (name === "page.tsx" && /<TopBar[\s/>]/.test(readFileSync(file, "utf8"))) pages.push(file);
      }
    };
    walk(app);
    expect(pages.length).toBeGreaterThan(2);
    for (const file of pages) {
      const route = "/" + relative(app, join(file, "..")).split("/").map((part) => (part === "[id]" && file.includes("/copy/") ? ids[0] : part.startsWith("[") ? "abc" : part)).join("/");
      expect(themeFor(route) === null || ownTopBar(route, ids), `${route} draws a TopBar under the site's header`).toBe(true);
    }
  });
});
