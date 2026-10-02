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
