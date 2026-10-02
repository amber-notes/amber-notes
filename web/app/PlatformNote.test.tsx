import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PlatformNote from "./PlatformNote";

const text = (html: string) => html.replace(/<[^>]+>/g, "");
const PLACES = ["hero", "band", "download", "header"] as const;
const render = (place: (typeof PLACES)[number], appStoreLive = false) => renderToStaticMarkup(<PlatformNote place={place} appStoreLive={appStoreLive} />);
/// The part a visitor on Windows, Android or Linux sees.
const other = (html: string) => html.slice(html.indexOf('<div class="pi pi-other'), html.includes('<div class="pi pi-ios') ? html.indexOf('<div class="pi pi-ios') : undefined);

describe("what Windows, Android and Linux see in place of Download for Mac", () => {
  it("says Amber Notes is for iPhone and Mac, and where the iPhone app stands until it's out", () => {
    expect(text(other(render("hero")))).toBe("Amber Notes is for iPhone and Mac. The iPhone app is coming to the App Store soon.Send myself the linkDownload for Mac");
    expect(text(other(render("hero", true)))).toBe("Amber Notes is for iPhone and Mac.Send myself the linkSee it on the App StoreDownload for Mac");
  });

  it("never asks about, names or hints at another platform", () => {
    for (const place of PLACES) {
      for (const live of [false, true]) {
        const html = render(place, live);
        expect(html, place).not.toMatch(/windows|android|linux|web app|want|yet|not on|for now|today, with/i);
        expect(html, place).not.toMatch(/<button|<input|<form|data-event/);
      }
    }
  });

  it("offers one thing to do: send themselves the link, by email where there's no share sheet", () => {
    expect(render("hero")).toContain('<a class="pi-send" href="mailto:?subject=Amber%20Notes&amp;body=https%3A%2F%2Fambernotes.app">Send myself the link</a>');
    expect(render("band")).toContain('href="mailto:?subject=Amber%20Notes&amp;body=https%3A%2F%2Fambernotes.app"');
    expect(render("download")).toContain('href="mailto:?subject=Amber%20Notes&amp;body=https%3A%2F%2Fambernotes.app%2Fdownload"');
  });

  it("links to the App Store only once the app is there", () => {
    for (const place of ["hero", "band", "download"] as const) {
      expect(other(render(place)), place).not.toContain("apps.apple.com");
      expect(other(render(place, true)), place).toContain('<a class="pi-link" href="https://apps.apple.com/app/id6817253103" target="_blank" rel="noopener noreferrer">See it on the App Store</a>');
    }
  });

  it("keeps the Mac download one step away: the download page from the home page, the file from the download page", () => {
    expect(other(render("hero"))).toContain('<a class="pi-link" href="/download">Download for Mac</a>');
    expect(other(render("band"))).toContain('<a class="pi-link" href="/download">Download for Mac</a>');
    expect(render("download")).toContain('<a class="pi-link" href="/download/mac" download="">Download for Mac</a>');
  });

  it("is a quiet link to the download page in the header", () => {
    expect(render("header")).toBe('<a class="pi-head" href="/download">For iPhone and Mac</a>');
  });
});

describe("what an iPhone sees in place of Download for Mac", () => {
  const ios = (html: string) => html.slice(html.indexOf('<div class="pi pi-ios'));

  it("says the iPhone app is coming, with the Mac download second, and invents no link", () => {
    const html = ios(render("hero"));
    expect(text(html)).toBe("Amber Notes for iPhone is coming to the App Store soon. It&#x27;s on Mac today.Download for Mac");
    expect(html).not.toMatch(/https?:|testflight/i);
    expect(html).not.toContain("<button");
  });

  it("links to the App Store once the app is there", () => {
    const html = ios(render("band", true));
    expect(html).toContain('href="https://apps.apple.com/app/id6817253103"');
    expect(text(html)).toBe("Download for iPhoneDownload for Mac");
  });

  it("leaves the download page, which is about the Mac app, as it is", () => {
    expect(render("download")).not.toContain("pi-ios");
  });
});
