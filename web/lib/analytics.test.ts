import { describe, expect, it } from "vitest";
import { analyticsEvent } from "./analytics";

const send = (url: string) => analyticsEvent({ type: "pageview" as const, url })?.url ?? null;

describe("website analytics", () => {
  it("counts public pages by their address alone", () => {
    expect(send("https://ambernotes.app/")).toBe("https://ambernotes.app/");
    expect(send("https://ambernotes.app/blog/some-post?ref=x#top")).toBe("https://ambernotes.app/blog/some-post");
    expect(send("https://ambernotes.app/download")).toBe("https://ambernotes.app/download");
  });

  it("never counts shared notes, connect, password reset, report or universal-link pages", () => {
    for (const path of ["/n/abc123", "/n", "/connect", "/connect?code=1", "/open/connect", "/open/note/x", "/report/abc123", "/reset-password", "/reset-password?token_hash=abc&type=recovery"]) {
      expect(send(`https://ambernotes.app${path}`), path).toBeNull();
    }
  });

  it("doesn't mistake a page that only starts with those letters", () => {
    expect(send("https://ambernotes.app/notes-app")).toBe("https://ambernotes.app/notes-app");
  });

  it("drops anything it can't read", () => {
    expect(send("not a url")).toBeNull();
  });
});
