import fs from "node:fs";
import path from "node:path";
import { MAC_DMG } from "./downloads";

/// The version people can download today: content/release.json, written by scripts/release-mac.sh
/// when a Mac release goes public. Null when the file is missing or unreadable. Server only.
export function publicVersion(): string | null {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(process.cwd(), "content", "release.json"), "utf8")).version;
    return typeof v === "string" && /^\d+(\.\d+)*$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/// The DMG to send a download to: the file the public release wrote (`file` in content/release.json),
/// so a site deployed before the first Pinto Notes release still points at the file it has. Without
/// a release, or with a name that isn't one of ours, the stable name. Server only.
export function macDmg(read: () => string = readRelease): string {
  try {
    const file = JSON.parse(read()).file;
    if (typeof file === "string" && /^(?:Amber|Pinto)-Notes\.dmg$/.test(file)) return `/downloads/${file}`;
  } catch { /* no release yet */ }
  return MAC_DMG;
}

function readRelease(): string {
  return fs.readFileSync(path.join(process.cwd(), "content", "release.json"), "utf8");
}
