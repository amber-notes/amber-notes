import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "../middleware";
import { movedTo } from "./site-move";

const moved = (url: string) => movedTo(new URL(url).host, new URL(url));

describe("the move to pintonotes.com", () => {
  it("sends every page on ambernotes.app to the same path and query on pintonotes.com", () => {
    expect(moved("https://ambernotes.app/")).toBe("https://pintonotes.com/");
    expect(moved("https://ambernotes.app/blog/mcp-server?utm_source=x&a=1")).toBe("https://pintonotes.com/blog/mcp-server?utm_source=x&a=1");
    expect(moved("https://www.ambernotes.app/templates/habit-tracker")).toBe("https://pintonotes.com/templates/habit-tracker");
    expect(moved("https://ambernotes.app/n/abc123")).toBe("https://pintonotes.com/n/abc123");
    expect(moved("https://ambernotes.app/connect?request=1")).toBe("https://pintonotes.com/connect?request=1");
    expect(moved("https://ambernotes.app/download")).toBe("https://pintonotes.com/download");
    expect(moved("https://ambernotes.app/opener")).toBe("https://pintonotes.com/opener");
  });

  it("keeps what installed apps and Apple read on the old address", () => {
    for (const path of ["/.well-known/apple-app-site-association", "/updates/appcast.xml", "/downloads/Amber-Notes.dmg",
      "/api/templates/grocery-list", "/open/connect?request=1", "/open/template/trip-plan", "/open"]) {
      expect(moved(`https://ambernotes.app${path}`), path).toBeNull();
    }
  });

  it("keeps the IndexNow key on the old address, so its pages can be pinged too", () => {
    expect(moved("https://ambernotes.app/48cf0530fa40cbcfe5fa2c2a969c692f.txt")).toBeNull();
    expect(moved("https://ambernotes.app/notes.txt")).toBe("https://pintonotes.com/notes.txt");
  });

  it("moves the first address, amber-notes.vercel.app, the same way", () => {
    expect(moved("https://amber-notes.vercel.app/blog/mcp-server?a=1")).toBe("https://pintonotes.com/blog/mcp-server?a=1");
    expect(moved("https://amber-notes.vercel.app/n/abc123")).toBe("https://pintonotes.com/n/abc123");
    expect(moved("https://amber-notes.vercel.app/updates/appcast.xml")).toBeNull();
    expect(moved("https://amber-notes.vercel.app/downloads/Amber-Notes.dmg")).toBeNull();
  });

  it("sends all of www.pintonotes.com to pintonotes.com", () => {
    expect(moved("https://www.pintonotes.com/help?q=sync")).toBe("https://pintonotes.com/help?q=sync");
    expect(moved("https://www.pintonotes.com/updates/appcast.xml")).toBe("https://pintonotes.com/updates/appcast.xml");
  });

  it("leaves the new address and the MCP hosts alone", () => {
    expect(moved("https://pintonotes.com/blog")).toBeNull();
    expect(moved("https://mcp.ambernotes.app/")).toBeNull();
    expect(moved("https://mcp.pintonotes.com/token")).toBeNull();
  });

  it("answers with a permanent redirect that keeps the method", async () => {
    const res = await middleware(new NextRequest("https://ambernotes.app/help?q=sync", { headers: { host: "ambernotes.app" } }));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://pintonotes.com/help?q=sync");
  });

  it("runs on every host that moves", async () => {
    const { config } = await import("../middleware");
    const hosts = config.matcher.flatMap((m) => (typeof m === "string" ? [] : m.has.map((h) => new RegExp(`^(?:${h.value})$`))));
    for (const host of ["ambernotes.app", "www.ambernotes.app", "amber-notes.vercel.app", "www.pintonotes.com"]) {
      expect(hosts.some((re) => re.test(host)), host).toBe(true);
    }
    expect(hosts.some((re) => re.test("pintonotes.com"))).toBe(false);
  });
});
