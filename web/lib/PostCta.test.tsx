import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { clickEvents } from "./posthog";
import { PostCta } from "./PostCta";

vi.mock("next/navigation", () => ({ usePathname: () => "/blog/apple-notes-api", useRouter: () => ({ push: () => {} }) }));

const render = (appStoreLive = false) => renderToStaticMarkup(
  <PostCta slug="apple-notes-api" position="how-amber-helps" title="Try it" appStoreLive={appStoreLive}><p>Why.</p></PostCta>,
);
const links = (html: string) => [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]);
const attr = (tag: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

describe("a post's call to action", () => {
  it("names the post, its place and what each link does, on every link", () => {
    for (const live of [false, true]) {
      const tags = links(render(live));
      expect(tags.length).toBeGreaterThan(0);
      for (const tag of tags) {
        expect(attr(tag, "data-cta"), tag).toBe("apple-notes-api");
        expect(attr(tag, "data-cta-position"), tag).toBe("how-amber-helps");
        expect(attr(tag, "data-cta-action"), tag).toMatch(/^(download_mac|send_link|app_store)$/);
      }
    }
  });

  it("downloads on a Mac, and the click counts as the call to action and as a download from the post", () => {
    const tag = links(render()).find((t) => attr(t, "data-cta-action") === "download_mac")!;
    expect(tag).toContain('href="/download/mac"');
    expect(tag).toMatch(/class="[^"]*pi-apple pi-not-ios/);
    const el = { tagName: "A", getAttribute: (n: string) => attr(tag, n) };
    const sent = clickEvents(el, new URL("https://ambernotes.app/blog/apple-notes-api"));
    expect(sent.map((e) => [e.event, e.properties.path])).toEqual([["blog_cta_clicked", "/blog/apple-notes-api"], ["download_mac_clicked", "/blog/apple-notes-api"]]);
  });

  it("tells an iPhone the app is coming until it's on the App Store, and offers the link to the post", () => {
    const html = render();
    expect(html).toContain("The iPhone app is coming to the App Store soon.");
    expect(html).toContain("body=https%3A%2F%2Fambernotes.app%2Fblog%2Fapple-notes-api");
    expect(html).not.toContain("apps.apple.com");
    expect(render(true)).toContain("apps.apple.com");
    expect(render(true)).not.toContain("coming to the App Store");
  });
});
