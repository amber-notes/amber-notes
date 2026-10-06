import type { CaptureResult } from "posthog-js";
import { describe, expect, it } from "vitest";
import { clickEvent, heatmapsAllowed, newScrollMarks, POSTHOG_DEFAULT_HOST, posthogAllowed, posthogOptions, posthogSettings, sanitizeEvent, scrolledPercent, visitorOptedOut } from "./posthog";

const here = new URL("https://ambernotes.app/blog/claude-and-apple-notes");
const link = (href: string, attrs: Record<string, string> = {}) => ({ tagName: "A", getAttribute: (n: string) => (n === "href" ? href : attrs[n] ?? null) });
const event = (properties: Record<string, unknown>, extra: Partial<CaptureResult> = {}): CaptureResult =>
  ({ uuid: "u", event: "$pageview", properties, ...extra }) as CaptureResult;

describe("website PostHog", () => {
  it("loads on public pages", () => {
    for (const path of ["/", "/blog", "/blog/some-post", "/download", "/templates/standup", "/privacy-security", "/notes-app", "/opener", "/reports"]) {
      expect(posthogAllowed(path), path).toBe(true);
    }
  });

  it("never loads on shared notes, connect, universal-link, report or download-redirect pages", () => {
    for (const path of ["/n", "/n/abc123", "/connect", "/connect/done", "/connect-ai", "/open/connect", "/open/template/x", "/report/abc123", "/download/mac", "/reset-password", "/reset-password/done", "/account/reset", "/unsubscribe", "/unsubscribe/confirm"]) {
      expect(posthogAllowed(path), path).toBe(false);
    }
    expect(posthogAllowed(null)).toBe(false);
  });

  it("is off without a key, and on the EU host by default", () => {
    expect(posthogSettings({})).toBeNull();
    expect(posthogSettings({ key: "  " })).toBeNull();
    expect(posthogSettings({ key: "phc_x" })).toEqual({ key: "phc_x", host: POSTHOG_DEFAULT_HOST });
    expect(POSTHOG_DEFAULT_HOST).toBe("https://eu.i.posthog.com");
  });

  it("keeps nothing on the device and records nobody", () => {
    const o = posthogOptions(POSTHOG_DEFAULT_HOST);
    expect(o.cookieless_mode).toBe("always");
    expect(o.persistence).toBe("memory");
    expect(o.person_profiles).toBe("never");
    expect(o.disable_session_recording).toBe(true);
    expect(o.disable_surveys).toBe(true);
    expect(o.respect_dnt).toBe(true);
    expect(o.autocapture).toMatchObject({ dom_event_allowlist: ["click"], element_allowlist: ["a", "button"] });
    expect(o.session_recording).toMatchObject({ maskAllInputs: true });
    expect(o.capture_heatmaps).toBe(true);
    expect(o.rageclick).toBe(true);
    expect(o.capture_dead_clicks).toBe(true);
    expect(o.disable_session_recording).toBe(true);
    expect(o.disable_external_dependency_loading).toBe(true);
    expect(o.advanced_disable_flags).toBe(true);
  });

  it("isn't fetched for Do Not Track or Global Privacy Control", () => {
    expect(visitorOptedOut({ doNotTrack: "1" })).toBe(true);
    expect(visitorOptedOut({ globalPrivacyControl: true })).toBe(true);
    expect(visitorOptedOut({ doNotTrack: null }, { doNotTrack: "1" })).toBe(true);
    expect(visitorOptedOut({ doNotTrack: "0" })).toBe(false);
    expect(visitorOptedOut(undefined)).toBe(false);
  });

  it("drops events from private pages and strips queries and person properties", () => {
    expect(sanitizeEvent(event({ $current_url: "https://ambernotes.app/n/abc", $pathname: "/n/abc" }))).toBeNull();
    expect(sanitizeEvent(event({ $current_url: "https://ambernotes.app/connect?code=1" }))).toBeNull();
    const out = sanitizeEvent(event(
      { $current_url: "https://ambernotes.app/blog/x?ref=a#top", $pathname: "/blog/x", $referrer: "https://news.ycombinator.com/item?id=1", $initial_referrer: "$direct", $session_entry_url: "https://ambernotes.app/?code=1#x", $session_entry_referrer: "$direct" },
      { $set: { a: 1 }, $set_once: { b: 2 } },
    ));
    expect(out?.properties).toMatchObject({ $current_url: "https://ambernotes.app/blog/x", $referrer: "https://news.ycombinator.com/item", $initial_referrer: "$direct", $session_entry_url: "https://ambernotes.app/", $session_entry_referrer: "$direct" });
    expect(out).not.toHaveProperty("$set");
    expect(out).not.toHaveProperty("$set_once");
    expect(sanitizeEvent(null)).toBeNull();
  });

  it("names the download click, with the page it came from", () => {
    expect(clickEvent(link("/download/mac"), here)).toEqual({ event: "download_mac_clicked", properties: { path: "/blog/claude-and-apple-notes" }, leaves: false });
    expect(clickEvent(link("https://ambernotes.app/download/mac"), new URL("https://ambernotes.app/"))?.properties).toEqual({ path: "/" });
  });

  it("names Use template and Copy the prompt", () => {
    expect(clickEvent(link("/open/template/standup"), here)).toMatchObject({ event: "use_template_clicked", properties: { template: "standup" } });
    const button = { tagName: "BUTTON", getAttribute: (n: string) => (n === "data-event" ? "copy_prompt_clicked" : null) };
    expect(clickEvent(button, here)).toEqual({ event: "copy_prompt_clicked", properties: { path: here.pathname }, leaves: false });
  });

  it("has no event of its own for Send myself the link", () => {
    const send = link("mailto:?subject=Amber%20Notes&body=https%3A%2F%2Fambernotes.app");
    expect(clickEvent(send, new URL("https://ambernotes.app/"))).toBeNull();
  });

  it("keeps a preview's ?as= out of every address it sends", () => {
    expect(clickEvent(link("/download/mac"), new URL("https://ambernotes.app/?as=windows"))).toEqual({ event: "download_mac_clicked", properties: { path: "/" }, leaves: false });
    expect(sanitizeEvent(event({ $current_url: "https://ambernotes.app/download?as=windows" }))?.properties.$current_url).toBe("https://ambernotes.app/download");
  });

  it("names outbound links to the App Store, GitHub, Claude and ChatGPT, without their query", () => {
    const cases: [string, string][] = [
      ["https://apps.apple.com/app/id6817253103", "outbound_app_store_clicked"],
      ["https://github.com/amber-notes/amber-notes?tab=readme", "outbound_github_clicked"],
      ["https://claude.ai/new", "outbound_claude_clicked"],
      ["https://support.claude.com/en/articles/1", "outbound_claude_clicked"],
      ["https://chatgpt.com/", "outbound_chatgpt_clicked"],
      ["https://help.openai.com/en/articles/1", "outbound_chatgpt_clicked"],
    ];
    for (const [href, name] of cases) expect(clickEvent(link(href), here)?.event, href).toBe(name);
    expect(clickEvent(link("https://github.com/amber-notes/amber-notes?tab=readme"), here)?.properties.destination).toBe("https://github.com/amber-notes/amber-notes");
    expect(clickEvent(link("https://github.com/x"), here)?.leaves).toBe(true);
    expect(clickEvent(link("https://github.com/x", { target: "_blank" }), here)?.leaves).toBe(false);
  });

  it("leaves other links alone", () => {
    for (const href of ["/blog", "#top", "mailto:hi@ambernotes.app", "https://x.com/EmilWagman", "https://notgithub.com/"]) {
      expect(clickEvent(link(href), here), href).toBeNull();
    }
    expect(clickEvent({ tagName: "BUTTON", getAttribute: () => null }, here)).toBeNull();
  });

  it("sends each scroll mark once per page", () => {
    expect(scrolledPercent(0, 800, 800)).toBeNull();
    expect(scrolledPercent(0, 800, 3200)).toBe(25);
    expect(scrolledPercent(2399.6, 800, 3200)).toBe(100);
    const sent = new Set<number>();
    expect(newScrollMarks(30, sent)).toEqual([25]);
    sent.add(25);
    expect(newScrollMarks(80, sent)).toEqual([50, 75]);
    sent.add(50).add(75);
    expect(newScrollMarks(60, sent)).toEqual([]);
    expect(newScrollMarks(100, sent)).toEqual([100]);
    expect(newScrollMarks(null, new Set())).toEqual([]);
  });
});

describe("heatmaps, rage clicks and dead clicks", () => {
  const point = (type: string) => ({ x: 10, y: 20, target_fixed: false, type });

  it("are kept on the marketing pages only", () => {
    for (const path of ["/", "/download", "/templates", "/templates/trip-plan", "/blog", "/blog/apple-notes-mcp", "/blog/category/guides", "/help", "/changelog", "/privacy-security"]) {
      expect(heatmapsAllowed(path), path).toBe(true);
    }
    for (const path of ["/n/abc", "/connect", "/open/template/x", "/report/abc", "/reset-password", "/download/mac", "/privacy", "/terms", "/support", "/templates/x/y", "/nothing"]) {
      expect(heatmapsAllowed(path), path).toBe(false);
    }
  });

  it("send clicks from marketing pages only, without queries, and no pointer movement", () => {
    const out = sanitizeEvent(event({
      $current_url: "https://ambernotes.app/templates?category=work",
      $heatmap_data: {
        "https://ambernotes.app/templates?category=work#top": [point("click"), point("mousemove"), point("rageclick")],
        "https://ambernotes.app/": [point("click")],
        "https://ambernotes.app/n/abcdefghijklmnopqrstuvwx": [point("click")],
        "https://ambernotes.app/terms": [point("click")],
        "https://ambernotes.app/blog": [point("mousemove")],
      },
    }, { event: "$$heatmap" }));
    expect(out?.properties.$heatmap_data).toEqual({
      "https://ambernotes.app/templates": [point("click"), point("rageclick")],
      "https://ambernotes.app/": [point("click")],
    });
  });

  it("drop a heatmap batch with nothing left", () => {
    expect(sanitizeEvent(event({ $current_url: "https://ambernotes.app/", $heatmap_data: { "https://ambernotes.app/privacy": [point("click")] } }, { event: "$$heatmap" }))).toBeNull();
    expect(sanitizeEvent(event({ $current_url: "https://ambernotes.app/" }, { event: "$$heatmap" }))).toBeNull();
  });

  it("keep rage and dead clicks on marketing pages and drop them elsewhere", () => {
    for (const name of ["$rageclick", "$dead_click"]) {
      expect(sanitizeEvent(event({ $current_url: "https://ambernotes.app/download", $pathname: "/download" }, { event: name })), name).not.toBeNull();
      expect(sanitizeEvent(event({ $current_url: "https://ambernotes.app/terms", $pathname: "/terms" }, { event: name })), name).toBeNull();
      expect(sanitizeEvent(event({ $current_url: "https://ambernotes.app/n/abc", $pathname: "/n/abc" }, { event: name })), name).toBeNull();
    }
  });

  it("leave ordinary events on other public pages alone", () => {
    expect(sanitizeEvent(event({ $current_url: "https://ambernotes.app/terms", $pathname: "/terms" }))).not.toBeNull();
    expect(sanitizeEvent(event({ $current_url: "https://ambernotes.app/terms" }, { event: "$autocapture" }))).not.toBeNull();
  });
});
