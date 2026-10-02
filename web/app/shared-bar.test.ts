import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The shared-note bar (lib/NotePage.tsx) on narrow phones: only the logo and "Use this note", and
// neither may shrink, so the button is never pushed off a 320 px screen. Who shared the note sits
// under the title, where a long name truncates instead of crowding the bar.
const css = readFileSync(join(__dirname, "../lib/note-page.module.css"), "utf8");
const ui = readFileSync(join(__dirname, "../lib/ui.module.css"), "utf8");

describe("the shared-note bar on narrow phones", () => {
  it("shows the logo alone below 361 px", () => {
    expect(ui).toContain("@media (max-width: 360px) { .brand span { display: none; } }");
  });

  it("never lets the button or the logo shrink", () => {
    expect(css).toMatch(/\.use \{\s*flex: none;/);
    expect(ui).toMatch(/\.brand \{ flex: none;/);
  });

  it("truncates a long sharer's name under the title", () => {
    expect(css).toMatch(/\.bylineName \{[^}]*text-overflow: ellipsis/);
  });
});
