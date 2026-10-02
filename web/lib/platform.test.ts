import { describe, expect, it } from "vitest";
import { INTEREST_KEY, markInterest, platformScript } from "./platform";

type Nav = { userAgent?: string; maxTouchPoints?: number; userAgentData?: { platform?: string } };

/// Runs the <head> script the way a browser would, and gives back what it put on <html>.
function run(navigator: Nav | undefined, localStorage: unknown = { getItem: () => null }) {
  const html = { dataset: {} as Record<string, string> };
  new Function("navigator", "document", "localStorage", platformScript)(navigator, { documentElement: html }, localStorage);
  return html.dataset;
}

const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.7 Mobile/15E148 Safari/604.1",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  windowsFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  androidFirefox: "Mozilla/5.0 (Android 15; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  ubuntuFirefox: "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0",
  chromeOS: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
};

describe("the visitor's platform, before first paint", () => {
  it.each([
    ["iphone", "ios"], ["ipad", "ios"], ["mac", "mac"], ["macChrome", "mac"],
    ["windows", "windows"], ["windowsFirefox", "windows"],
    ["android", "android"], ["androidFirefox", "android"],
    ["linux", "linux"], ["ubuntuFirefox", "linux"],
    ["chromeOS", "other"], ["googlebot", "other"],
  ] as const)("reads %s as %s", (ua, platform) => {
    expect(run({ userAgent: UA[ua] }).platform).toBe(platform);
  });

  it("tells an iPad that says it's a Mac by its touch screen", () => {
    expect(run({ userAgent: UA.mac, maxTouchPoints: 5 }).platform).toBe("ios");
    expect(run({ userAgent: UA.mac, maxTouchPoints: 0 }).platform).toBe("mac");
  });

  it("falls back to the browser's own platform name when the user agent says nothing", () => {
    for (const [hint, platform] of [["Windows", "windows"], ["Android", "android"], ["Linux", "linux"], ["macOS", "mac"], ["Chrome OS", "other"]]) {
      expect(run({ userAgent: "Mozilla/5.0", userAgentData: { platform: hint } }).platform, hint).toBe(platform);
    }
    expect(run({ userAgent: "" }).platform).toBe("other");
    expect(run({}).platform).toBe("other");
  });

  it("never throws, and leaves the page as the server sent it, without a navigator", () => {
    expect(run(undefined)).toEqual({});
  });

  it("shows the thanks from the first frame to a visitor who already said yes", () => {
    const asked: string[] = [];
    const stored = { getItem: (key: string) => (asked.push(key), "1") };
    expect(run({ userAgent: UA.windows }, stored)).toEqual({ platform: "windows", interest: "done" });
    expect(asked).toEqual([INTEREST_KEY]);
    expect(run({ userAgent: UA.windows }).interest).toBeUndefined();
  });

  it("still knows the platform when the browser refuses storage", () => {
    const refused = { getItem: () => { throw new DOMException("denied", "SecurityError"); } };
    expect(run({ userAgent: UA.android }, refused)).toEqual({ platform: "android" });
    expect(run({ userAgent: UA.android }, undefined as never)).toMatchObject({ platform: "android" });
  });
});

describe("saying yes", () => {
  it("marks the page and remembers it in this browser, storing nothing about the visitor", () => {
    const html = { dataset: {} as Record<string, string | undefined> };
    const saved: [string, string][] = [];
    markInterest({ documentElement: html }, () => ({ setItem: (k, v) => void saved.push([k, v]) }));
    expect(html.dataset.interest).toBe("done");
    expect(saved).toEqual([[INTEREST_KEY, "1"]]);
  });

  it.each([
    ["storage is full or turned off", () => ({ setItem: () => { throw new DOMException("full", "QuotaExceededError"); } })],
    ["reading localStorage itself throws", () => { throw new DOMException("denied", "SecurityError"); }],
  ])("still shows the thanks when %s", (_, storage) => {
    const html = { dataset: {} as Record<string, string | undefined> };
    expect(() => markInterest({ documentElement: html }, storage)).not.toThrow();
    expect(html.dataset.interest).toBe("done");
  });
});
