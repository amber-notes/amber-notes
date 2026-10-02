import fs from "node:fs";
import path from "node:path";

/// One release, newest first in content/changelog.json. Only major and minor releases (1.0, 1.1, 1.2) get an
/// entry; patch releases (1.1.1, 1.1.2) don't, and anything worth telling people goes into the next minor.
/// The apps bundle the same file: a release marked `major` shows a "What's new" card with its
/// `highlights` (3 or 4 short lines) once after updating.
export type Release = {
  version: string;
  date: string;
  title: string;
  items: string[];
  major?: boolean;
  highlights?: string[];
};

const read = (file: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), "content", file), "utf8"));

/// The releases people can get. An entry is written when its release is cut (the apps bundle the
/// file), which can be days before the release is public, so the site shows nothing newer than the
/// public Mac release (content/release.json, written by scripts/release-mac.sh).
export function changelog(): Release[] {
  try {
    const all: Release[] = read("changelog.json");
    let live: string | null = null;
    try { live = read("release.json").version ?? null; } catch { /* no public release yet: show all */ }
    return released(all, live);
  } catch {
    return [];
  }
}

/// `releases` without those newer than `live`, the public version ("1.1.2" covers 1.1, not 1.2).
export function released(releases: Release[], live: string | null): Release[] {
  if (!live) return releases;
  const [major, minor = 0] = live.split(".").map(Number);
  return releases.filter((r) => {
    const [a, b = 0] = r.version.split(".").map(Number);
    return a < major || (a === major && b <= minor);
  });
}

export function latestVersion(): string | null {
  return changelog()[0]?.version ?? null;
}
