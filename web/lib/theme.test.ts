import { describe, expect, it } from "vitest";
import { themeFor, themeScript } from "./theme";

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
