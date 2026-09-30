import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AI_ACCESS, CAVEAT, COUNTS, ENCRYPTION, FACTS, LIMITS, LOGS, PRIVACY_PATH, READABLE, WHO_CAN_SEE } from "./privacy";
import { themeFor } from "./theme";

const page = readFileSync(join(__dirname, "../app/privacy-security/page.tsx"), "utf8");
const policy = readFileSync(join(__dirname, "../content/privacy-policy.md"), "utf8");
const docsPolicy = readFileSync(join(__dirname, "../../docs/privacy-policy.md"), "utf8");
const items = [...ENCRYPTION.items, ...WHO_CAN_SEE, ...AI_ACCESS, ...LIMITS];
const copy = [
  ...FACTS.flatMap((f) => [f.title, f.text]), CAVEAT.text, CAVEAT.link, ...LOGS.flatMap((l) => [l.name, l.what, l.kept]), ...COUNTS, ...READABLE,
  ...items.flatMap((i) => [i.label, i.text]), ENCRYPTION.note, page, policy,
];
const all = copy.join("\n");

describe("privacy copy", () => {
  it("has no em dashes and never mentions iPad", () => {
    for (const t of [...copy, docsPolicy]) {
      expect(t).not.toMatch(/—/);
      expect(t).not.toMatch(/iPad/);
    }
  });

  it("never claims more than is true today", () => {
    const lower = all.toLowerCase();
    expect(lower).not.toMatch(/only you can read/);
    expect(lower).not.toMatch(/nobody (else|but you) can read (it|your notes)/);
    expect(lower).not.toMatch(/no logs\b/);
    expect(lower).not.toMatch(/zeroed/);
    // The honest parts of the model, on the page and in the policy.
    for (const text of [READABLE.join(" "), policy]) {
      for (const phrase of ["email", "sign-in records", "profile name and photo", "notes-password hint", "size and dates", "sub-notes", "pinned", "locked", "ai apps", "devices", "ai connections", "usage counts", "share"]) {
        expect(text.toLowerCase(), phrase).toContain(phrase);
      }
    }
    const limits = [...AI_ACCESS, ...LIMITS].map((i) => i.label + " " + i.text).join(" ");
    for (const text of [limits, policy]) {
      expect(text).toMatch(/unlocks your whole notes' key in memory/);
      expect(text).toMatch(/Vercel and Supabase/);
      expect(text).toMatch(/No key rotation yet/);
      expect(text).toMatch(/runs our code in your browser/);
      expect(text).toMatch(/a changed page could read/);
      expect(text).toMatch(/roll a note back/);
      expect(text).toMatch(/hide notes/);
    }
    expect(ENCRYPTION.items.map((i) => i.text).join(" ")).toMatch(/iCloud Keychain/);
  });

  it("has no Coming note: end to end is what's built", () => {
    expect(all).not.toMatch(/Coming:|not end-to-end encrypted yet/);
    expect(FACTS[0].title).toBe("End-to-end encrypted");
  });

  it("keeps the two policy files the same", () => {
    expect(policy).toBe(docsPolicy);
  });

  it("lists the same log retention as the privacy policy", () => {
    for (const l of LOGS) expect(policy.toLowerCase()).toContain(l.kept);
    expect(policy).toContain("no backups");
    expect(policy).toContain("Export Your Notes");
    expect(page).toContain("Export Your Notes");
  });

  it("is a cream page like the other legal pages", () => {
    expect(themeFor(PRIVACY_PATH)).toBe("cream");
  });
});
