import { describe, expect, it } from "vitest";
import { FOOTER_FX_KEY, footerFx } from "./footer-fx";

function tab(start: Record<string, string> = {}) {
  const kept = new Map(Object.entries(start));
  return { kept, getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) };
}

describe("footerFx", () => {
  it("leaves the footer alone without a choice", () => {
    expect(footerFx("", tab())).toBeNull();
    expect(footerFx("?footer=z", tab())).toBeNull();
  });

  it("takes the choice from the address and keeps it for the tab", () => {
    const store = tab();
    expect(footerFx("?footer=b", store)).toBe("b");
    expect(footerFx("", store)).toBe("b");
  });

  it("clears the kept choice with any other value", () => {
    const store = tab({ [FOOTER_FX_KEY]: "c" });
    expect(footerFx("?footer=off", store)).toBeNull();
    expect(store.kept.size).toBe(0);
  });

  it("works when storage throws", () => {
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => {} };
    expect(footerFx("?footer=a", blocked)).toBe("a");
    expect(footerFx("", null)).toBeNull();
  });
});
