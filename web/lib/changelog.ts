import fs from "node:fs";
import path from "node:path";

/// One release, newest first in content/changelog.json. scripts/release-mac.sh adds an entry on every release.
export type Release = { version: string; date: string; title: string; items: string[] };

export function changelog(): Release[] {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "content", "changelog.json"), "utf8"));
  } catch {
    return [];
  }
}

export function latestVersion(): string | null {
  return changelog()[0]?.version ?? null;
}
