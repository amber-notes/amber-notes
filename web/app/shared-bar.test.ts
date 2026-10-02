import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The shared-note bar (lib/NotePage.tsx) on narrow phones. A media query only wins over the base
// rule it overrides when it comes later in the file; the first version had it earlier, so the
// sharer's name never hid and "Use this note" was pushed off a 393 px screen.
const css = readFileSync(join(__dirname, "globals.css"), "utf8");

describe("the shared-note bar on narrow phones", () => {
  it("hides the sharer's name below 421 px, after the rule that shows it", () => {
    const base = css.indexOf(".sharer-text { display: flex;");
    const narrow = css.indexOf("@media (max-width: 420px) { .sharer-text { display: none; } .sharer { flex: none; } }");
    expect(base).toBeGreaterThan(-1);
    expect(narrow).toBeGreaterThan(base);
  });

  it("shows the logo alone below 361 px", () => {
    expect(css).toContain("@media (max-width: 360px) { .brand span { display: none; } }");
  });
});
