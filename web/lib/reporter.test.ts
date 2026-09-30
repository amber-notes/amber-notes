import { describe, expect, it } from "vitest";
import { reporterHash } from "./reporter";

describe("reporterHash", () => {
  const sept = new Date("2026-09-02T10:00:00Z"), lateSept = new Date("2026-09-30T23:00:00Z"), oct = new Date("2026-10-01T00:00:00Z");
  it("is the same for one address within a month", () => {
    expect(reporterHash("203.0.113.9", "s", sept)).toMatch(/^[0-9a-f]{64}$/);
    expect(reporterHash("203.0.113.9", "s", lateSept)).toBe(reporterHash("203.0.113.9", "s", sept));
  });
  it("changes with the month, the salt and the address", () => {
    const h = reporterHash("203.0.113.9", "s", sept);
    expect(reporterHash("203.0.113.9", "s", oct)).not.toBe(h);
    expect(reporterHash("203.0.113.9", "t", sept)).not.toBe(h);
    expect(reporterHash("203.0.113.10", "s", sept)).not.toBe(h);
  });
  it("never uses a guessable key when the salt is missing", () => {
    expect(reporterHash("203.0.113.9", "", sept)).not.toBe(reporterHash("203.0.113.9", "amber-notes", sept));
  });
});
