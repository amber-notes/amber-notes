import { describe, expect, it } from "vitest";
import { changelog, latestVersion } from "./changelog";

// The apps bundle content/changelog.json too: a `major` release shows a "What's new" card with its highlights.
describe("changelog", () => {
  const releases = changelog();

  it("lists only major and minor releases, never a patch release", () => {
    for (const r of releases) expect(r.version).toMatch(/^\d+\.\d+$/);
  });

  it("reads every release, newest first", () => {
    expect(releases.length).toBeGreaterThan(0);
    expect(latestVersion()).toBe(releases[0].version);
    for (const r of releases) {
      expect(r.version).toMatch(/^\d+(\.\d+)*$/);
      expect(r.items.length).toBeGreaterThan(0);
    }
  });

  it("gives every major release 3 or 4 short highlights for the app's card", () => {
    for (const r of releases.filter((r) => r.major)) {
      expect(r.highlights?.length ?? 0).toBeGreaterThanOrEqual(3);
      expect(r.highlights?.length ?? 0).toBeLessThanOrEqual(4);
      for (const h of r.highlights ?? []) {
        expect(h.length).toBeLessThanOrEqual(90);
        expect(h).not.toMatch(/—/);
      }
    }
  });

  it("marks 1.1 major, and only major releases carry highlights", () => {
    const v11 = releases.find((r) => r.version === "1.1");
    expect(v11?.major).toBe(true);
    expect(v11?.highlights).toContain("Connect your AI apps once more after this update.");
    for (const r of releases.filter((r) => !r.major)) expect(r.highlights).toBeUndefined();
  });
});
