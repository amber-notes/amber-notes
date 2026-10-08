import { describe, expect, it, vi } from "vitest";
import { endPreview, mailLink, platformScript, PREVIEW_KEY, sendLink } from "./platform";

type Nav = { userAgent?: string; maxTouchPoints?: number; userAgentData?: { platform?: string } };

/// A tab's sessionStorage, as the <head> script sees it.
function tab(start: Record<string, string> = {}) {
  const kept = new Map(Object.entries(start));
  return { kept, getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) };
}

/// Runs the <head> script the way a browser would, and gives back what it put on <html>.
function run(navigator: Nav | undefined, search = "", sessionStorage: unknown = tab()) {
  const html = { dataset: {} as Record<string, string> };
  new Function("navigator", "document", "location", "sessionStorage", platformScript)(navigator, { documentElement: html }, { search }, sessionStorage);
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

  it("keeps nothing in localStorage", () => {
    expect(platformScript).not.toContain("localStorage");
    expect(run({ userAgent: UA.windows })).toEqual({ platform: "windows" });
  });
});

describe("Send myself the link", () => {
  it("is an email to nobody yet, with the link in it", () => {
    expect(mailLink("https://ambernotes.app")).toBe("mailto:?subject=Pinto%20Notes&body=https%3A%2F%2Fambernotes.app");
    expect(mailLink("https://ambernotes.app/download")).toContain("body=https%3A%2F%2Fambernotes.app%2Fdownload");
  });

  it("opens the share sheet where the browser has one, in place of the email", () => {
    const share = vi.fn(async () => {});
    const event = { preventDefault: vi.fn() };
    sendLink({ share }, event, "https://ambernotes.app");
    expect(share).toHaveBeenCalledWith({ title: "Pinto Notes", url: "https://ambernotes.app" });
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("lets the email open where there's no share sheet", () => {
    const event = { preventDefault: vi.fn() };
    sendLink({}, event, "https://ambernotes.app");
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("stays quiet when the share sheet is closed without sending", async () => {
    const share = vi.fn(async () => { throw new DOMException("cancelled", "AbortError"); });
    expect(() => sendLink({ share }, { preventDefault() {} }, "https://ambernotes.app")).not.toThrow();
    await Promise.resolve();
  });
});

describe("previewing another platform with ?as=", () => {
  const mac = { userAgent: UA.mac };

  it.each([
    ["windows", "windows"], ["android", "android"], ["linux", "linux"], ["iphone", "ios"], ["mac", "mac"],
  ])("?as=%s shows the site as that visitor sees it, and says it's a preview", (as, platform) => {
    expect(run(mac, `?as=${as}`)).toEqual({ platform, as });
    expect(run({ userAgent: UA.windows }, `?utm_source=x&as=${as}`)).toEqual({ platform, as });
  });

  it("sticks for the tab while the parameter is gone, and ?as=off clears it", () => {
    const session = tab();
    expect(run(mac, "?as=windows", session).as).toBe("windows");
    expect(session.kept.get(PREVIEW_KEY)).toBe("windows");
    expect(run(mac, "", session)).toEqual({ platform: "windows", as: "windows" });
    expect(run(mac, "?as=linux", session)).toEqual({ platform: "linux", as: "linux" });
    expect(run(mac, "?as=off", session)).toEqual({ platform: "mac" });
    expect(session.kept.size).toBe(0);
    expect(run(mac, "", session)).toEqual({ platform: "mac" });
  });

  it("changes nothing for a visitor without the parameter, or with one it doesn't know", () => {
    const session = tab();
    for (const search of ["", "?ref=x", "?as=", "?as=ios", "?as=WINDOWS", "?as=windows2", "?has=windows", "?as=other"]) {
      expect(run({ userAgent: UA.windows }, search, session), search).toEqual({ platform: "windows" });
    }
    expect(session.kept.size).toBe(0);
  });

  it("works for the page it's on when the browser refuses sessionStorage", () => {
    const refused = { getItem: () => { throw new DOMException("denied", "SecurityError"); }, setItem: () => { throw new DOMException("denied", "SecurityError"); } };
    expect(run(mac, "?as=android", refused)).toEqual({ platform: "android", as: "android" });
    expect(run(mac, "", refused)).toEqual({ platform: "mac" });
    expect(run(mac, "", undefined as never)).toEqual({ platform: "mac" });
    expect(run({ userAgent: UA.android }, "", undefined as never)).toEqual({ platform: "android" });
  });

  it("Reset forgets the preview and reloads the page without the parameter", () => {
    const session = tab({ [PREVIEW_KEY]: "windows" });
    const went: string[] = [];
    endPreview(() => session, { pathname: "/download", replace: (url) => void went.push(url) });
    expect(session.kept.size).toBe(0);
    expect(went).toEqual(["/download"]);
    endPreview(() => { throw new DOMException("denied", "SecurityError"); }, { pathname: "/", replace: (url) => void went.push(url) });
    expect(went).toEqual(["/download", "/"]);
  });
});
