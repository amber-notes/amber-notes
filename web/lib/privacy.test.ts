import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMING, COUNTS, FACTS, LOGS, PRIVACY_PATH } from "./privacy";
import { themeFor } from "./theme";

const page = readFileSync(join(__dirname, "../app/privacy-security/page.tsx"), "utf8");
const policy = readFileSync(join(__dirname, "../content/privacy-policy.md"), "utf8");
const copy = [...FACTS.flatMap((f) => [f.title, f.text]), COMING.text, ...LOGS.flatMap((l) => [l.name, l.what, l.kept]), ...COUNTS, page];

describe("privacy copy", () => {
  it("has no em dashes and never mentions iPad", () => {
    for (const t of copy) {
      expect(t).not.toMatch(/—/);
      expect(t).not.toMatch(/iPad/);
    }
  });

  it("never claims more than is true today", () => {
    const all = copy.join("\n").toLowerCase();
    expect(all).not.toMatch(/only you can read your notes/);
    expect(all).not.toMatch(/all (of )?your notes are (end-to-end|end to end) encrypted/);
    expect(all).not.toMatch(/no logs\b/);
    // End-to-end encryption is claimed for locked notes only; for all notes it's "Coming".
    expect(COMING.text.startsWith("Coming:")).toBe(true);
    expect(FACTS.filter((f) => /end.to.end/i.test(f.title + f.text)).map((f) => f.title)).toEqual(["Locked notes are end-to-end encrypted"]);
  });

  it("lists the same log retention as the privacy policy", () => {
    for (const l of LOGS) expect(policy.toLowerCase()).toContain(l.kept);
    expect(policy).toContain("no backups");
    expect(policy).toContain("Export My Data");
  });

  it("is a cream page like the other legal pages", () => {
    expect(themeFor(PRIVACY_PATH)).toBe("cream");
  });
});
