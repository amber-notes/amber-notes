import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PlatformInterest, { today } from "./PlatformInterest";

const text = (html: string) => html.replace(/<[^>]+>/g, "");
const render = (place: "hero" | "band" | "download" | "header", appStoreLive = false) => renderToStaticMarkup(<PlatformInterest place={place} appStoreLive={appStoreLive} />);

describe("the ask shown in place of Download for Mac", () => {
  it("says where Amber Notes runs today, and asks about the visitor's platform by name", () => {
    const html = render("hero");
    expect(text(html)).toContain("Amber Notes is for Mac today, with iPhone coming soon. Want it on WindowsAndroidLinux?");
    expect(text(html)).toContain("Yes, I want it on WindowsAndroidLinux");
    // One name per platform, each marked for site.css to show the visitor's own.
    for (const platform of ["windows", "android", "linux"]) expect(html.match(new RegExp(`data-on="${platform}"`, "g")), platform).toHaveLength(2);
  });

  it("says iPhone and Mac once the iPhone app is on the App Store", () => {
    expect(today(true)).toBe("Amber Notes is for iPhone and Mac today.");
    expect(text(render("hero", true))).toContain("Amber Notes is for iPhone and Mac today. Want it on");
    expect(text(render("hero", true))).not.toContain("coming soon");
  });

  it("has one counted button, and its thanks ready for after the click", () => {
    for (const place of ["hero", "band", "download", "header"] as const) {
      const html = render(place);
      expect(html.match(/<button/g), place).toHaveLength(1);
      expect(html, place).toContain(`<button type="button" class="${place === "header" ? "pi-open" : "pi-button pi-open"}" data-event="platform_interest_clicked">`);
      expect(html.match(/role="status"/g), place).toHaveLength(1);
    }
    expect(render("hero")).toContain('<p class="pi-thanks pi-done" role="status">Thanks. We count these to decide what to build next.</p>');
    expect(render("header")).toContain('<span class="pi-done" role="status">Thanks, counted</span>');
  });

  it("keeps the Mac download one step away: the download page from the home page, the file from the download page", () => {
    expect(render("hero")).toContain('<a class="pi-link" href="/download">Download for Mac</a>');
    expect(render("band")).toContain('<a class="pi-link" href="/download">Download for Mac</a>');
    expect(render("download")).toContain('<a class="pi-link" href="/download/mac" download="">Download for Mac anyway</a>');
  });

  it("is only the button in the header", () => {
    const html = render("header");
    expect(html.startsWith('<span class="pi-ask pi-head">')).toBe(true);
    expect(text(html)).toBe("I want it on WindowsAndroidLinuxThanks, counted");
  });

  it("asks for nothing about the visitor: no field, no form, no link off the site", () => {
    for (const place of ["hero", "band", "download", "header"] as const) {
      expect(render(place), place).not.toMatch(/<input|<form|<textarea|https?:/);
    }
  });
});

describe("what an iPhone sees in place of Download for Mac", () => {
  it("says the iPhone app is coming, with the Mac download second, and invents no link", () => {
    const html = render("hero");
    const ios = html.slice(html.indexOf('<div class="pi pi-ios'));
    expect(text(ios)).toBe("Amber Notes for iPhone is coming to the App Store soon. It&#x27;s on Mac today.Download for Mac");
    expect(ios).not.toMatch(/https?:|testflight/i);
    expect(ios).not.toContain("<button");
  });

  it("links to the App Store once the app is there", () => {
    const html = render("band", true);
    const ios = html.slice(html.indexOf('<div class="pi pi-ios'));
    expect(ios).toContain('href="https://apps.apple.com/app/id6817253103"');
    expect(text(ios)).toBe("Download for iPhoneDownload for Mac");
  });

  it("leaves the download page, which is about the Mac app, as it is", () => {
    expect(render("download")).not.toContain("pi-ios");
  });
});
