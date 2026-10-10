import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { MAC_DMG, MAC_DOWNLOAD_PATH } from "./downloads";
import { macDmg } from "./public-release";

const root = join(__dirname, "..");
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(tsx?|md)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

describe("download links", () => {
  it("every link people click to download goes through the counter", () => {
    for (const file of [...sources(join(root, "app")), ...sources(join(root, "content"))]) {
      const src = readFileSync(file, "utf8");
      // An <a> straight at the DMG would download without being counted.
      expect(src, file).not.toMatch(/href=["{`]+\/downloads\//);
      expect(src, file).not.toMatch(/\]\(\S*\/downloads\/[^)]*\.dmg\)/);
    }
    expect(MAC_DOWNLOAD_PATH).toBe("/download/mac");
  });

  it("Sparkle updates fetch the versioned DMG directly, never the counter", () => {
    const release = readFileSync(join(root, "../scripts/release-mac.sh"), "utf8");
    const enclosure = release.split("\n").find((l) => l.includes("<enclosure"));
    // Installed apps read the feed and DMGs on the old address, which keeps serving them (lib/site-move.ts).
    expect(enclosure).toContain("https://ambernotes.app/downloads/$FILE");
    expect(release).not.toContain(MAC_DOWNLOAD_PATH);
  });
});

describe("the DMG's name after the rename to Pinto Notes", () => {
  it("is Pinto-Notes.dmg, or the file the public release wrote", () => {
    expect(MAC_DMG).toBe("/downloads/Pinto-Notes.dmg");
    expect(macDmg(() => { throw new Error("no release.json"); })).toBe("/downloads/Pinto-Notes.dmg");
    expect(macDmg(() => JSON.stringify({ version: "1.2", file: "Pinto-Notes.dmg" }))).toBe("/downloads/Pinto-Notes.dmg");
    // A site deployed before the first Pinto Notes release still holds only the old file.
    expect(macDmg(() => JSON.stringify({ version: "1.1.2", file: "Amber-Notes.dmg" }))).toBe("/downloads/Amber-Notes.dmg");
  });

  it("never sends a download to a name that isn't one of ours", () => {
    for (const file of ["../../etc/passwd", "https://evil.example/x.dmg", "Amber-Notes.dmg?x=1", "Other.dmg", 7, null]) {
      expect(macDmg(() => JSON.stringify({ file })), String(file)).toBe("/downloads/Pinto-Notes.dmg");
    }
    expect(macDmg(() => "{not json")).toBe("/downloads/Pinto-Notes.dmg");
  });

  it("answers the old file names with the new files, only once no file has the old name", async () => {
    const rw = (await nextConfig.rewrites!()) as { beforeFiles: unknown[]; afterFiles: unknown[]; fallback: { source: string; destination: string }[] };
    expect(rw.fallback).toEqual([
      { source: "/downloads/Amber-Notes.dmg", destination: "/downloads/Pinto-Notes.dmg" },
      { source: "/downloads/Amber-Notes-:version(\\d[\\d.]*).dmg", destination: "/downloads/Pinto-Notes-:version.dmg" },
    ]);
    // Before files and after files would hide a real Amber-Notes.dmg that a deploy still holds.
    expect(JSON.stringify([rw.beforeFiles, rw.afterFiles])).not.toContain("downloads");
  });
});
