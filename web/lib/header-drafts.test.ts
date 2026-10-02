import { describe, expect, it } from "vitest";
import { headerDraftScript, headerVariant } from "./header-drafts";

describe("the phone header drafts", () => {
  it("shows A unless B is asked for", () => {
    expect(headerVariant("", null)).toBe("a");
    expect(headerVariant("?header=b", null)).toBe("b");
    expect(headerVariant("?utm_source=x&header=b", null)).toBe("b");
    expect(headerVariant("?header=c", null)).toBe("a");
  });

  it("keeps the remembered draft until the address asks for the other", () => {
    expect(headerVariant("", "b")).toBe("b");
    expect(headerVariant("?header=a", "b")).toBe("a");
  });

  it("runs the same rule before first paint", () => {
    const run = (search: string, stored: string | null) => {
      const html = { dataset: {} as Record<string, string> };
      const store = new Map<string, string>(stored ? [["header", stored]] : []);
      const sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
      new Function("location", "sessionStorage", "document", headerDraftScript)({ search }, sessionStorage, { documentElement: html });
      return { shown: html.dataset.header ?? "a", stored: store.get("header") ?? null };
    };
    for (const [search, stored] of [["", null], ["?header=b", null], ["?x=1&header=b", null], ["", "b"], ["?header=a", "b"], ["?header=bb", null]] as const) {
      expect(run(search, stored).shown).toBe(headerVariant(search, stored));
    }
    expect(run("?header=b", null).stored).toBe("b");
    expect(run("?header=a", "b").stored).toBe("a");
  });
});
