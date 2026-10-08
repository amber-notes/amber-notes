import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAC_DOWNLOAD_PATH } from "./downloads";

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
