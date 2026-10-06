import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AI_ACCESS, CAVEAT, COUNTS, ENCRYPTION, FACTS, HOME_PRIVACY, LIMITS, LOGS, PRIVACY_PATH, READABLE, WHO_CAN_SEE } from "./privacy";
import { themeFor } from "./theme";

const page = readFileSync(join(__dirname, "../app/privacy-security/page.tsx"), "utf8");
const policy = readFileSync(join(__dirname, "../content/privacy-policy.md"), "utf8");
const docsPolicy = readFileSync(join(__dirname, "../../docs/privacy-policy.md"), "utf8");
const items = [...ENCRYPTION.items, ...WHO_CAN_SEE, ...AI_ACCESS, ...LIMITS];
const copy = [
  ...FACTS.flatMap((f) => [f.title, f.text]), CAVEAT.text, CAVEAT.link, ...LOGS.flatMap((l) => [l.name, l.what, l.kept]), ...COUNTS, ...READABLE,
  ...items.flatMap((i) => [i.label, i.text]), ENCRYPTION.note, page, policy,
  ...Object.values(HOME_PRIVACY),
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

  it("never says only your devices can open your notes: approved AI connections can too", () => {
    const facts = [...FACTS.map((f) => f.text), ...ENCRYPTION.items.map((i) => i.text), page].join(" ").toLowerCase();
    expect(facts).not.toMatch(/only your devices (hold|have|can)/);
    expect(FACTS[0].text).toMatch(/only your devices, and AI connections you approve, can unlock/);
  });

  it("says the AI exception on the home page, next to \"We can't read your notes\"", () => {
    expect(HOME_PRIVACY.text).toMatch(/When an AI you approve asks for notes, our server reads them in memory/);
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

  it("says what the website counts, and never that it counts nothing", () => {
    for (const text of [policy, page, FACTS.map((f) => f.text).join(" ")]) {
      expect(text).toMatch(/counts page views and where visitors came from/);
      expect(text).toMatch(/Mac downloads as daily totals/);
      expect(text).not.toMatch(/(on|or) (the|this) website, and we never/);
      expect(text).not.toMatch(/(apps and this website|website) (have|has|uses) no (analytics|tracking)/);
    }
    expect(policy).toMatch(/where on a page people click and how far pages are scrolled with PostHog, in the EU\. These are counted across all visitors; no visit is recorded\. Neither keeps a profile of you, and neither runs on shared notes or the connect pages\. Vercel never uses cookies\. PostHog uses none either, unless you choose Accept on the website's cookie banner/);
    expect(page).toMatch(/where on a page people click and how far pages are scrolled with PostHog, in the EU\. These are counted across all\s+visitors; no visit is recorded\. Neither keeps a profile of you, and neither runs on shared notes or the connect pages\.\s+PostHog uses a cookie only if you choose Accept on the cookie banner/);
    // Heatmaps are named, and limited to the marketing pages, in the long form too.
    expect(policy).toMatch(/where on the page each click landed.*no visit is recorded or replayed/);
    expect(policy).toMatch(/\| PostHog, Inc\. \| Website usage only/);
    expect(policy).toContain("None of this touches your notes or your computer");
  });

  it("says the website asks before its one cookie, and names everything it stores", () => {
    expect(policy).not.toMatch(/website sets no cookies/i);
    expect(policy).toContain("The website asks before it sets a cookie.");
    expect(policy).toContain("`amber_consent`");
    expect(policy).toContain("`ph_<project key>_posthog`, only if you accept");
    expect(policy).toMatch(/expires a year after your last visit/);
    expect(policy).toMatch(/Do Not Track or Global Privacy Control, we treat it as Reject/);
    expect(policy).toMatch(/\| Consent, which you can withdraw at any time with Cookie settings \|/);
  });

  it("is a cream page like the other legal pages", () => {
    expect(themeFor(PRIVACY_PATH)).toBe("cream");
  });
});
