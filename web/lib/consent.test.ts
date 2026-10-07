import { describe, expect, it } from "vitest";
import { bannerAsks, storedChoice } from "./consent";

describe("the cookie banner's answer", () => {
  it("reads what PostHog stores, and nothing else, as an answer", () => {
    expect(storedChoice("1")).toBe("accepted");
    expect(storedChoice("true")).toBe("accepted");
    expect(storedChoice("0")).toBe("rejected");
    expect(storedChoice("false")).toBe("rejected");
    expect(storedChoice(null)).toBeNull();
    expect(storedChoice("")).toBeNull();
    expect(storedChoice("yes please")).toBeNull();
  });

  it("asks once, only where PostHog may run, and never a visitor with Do Not Track or Global Privacy Control", () => {
    expect(bannerAsks(true, false, null)).toBe(true);
    expect(bannerAsks(true, false, "accepted")).toBe(false);
    expect(bannerAsks(true, false, "rejected")).toBe(false);
    expect(bannerAsks(true, true, null)).toBe(false);
    expect(bannerAsks(false, false, null)).toBe(false);
  });
});
