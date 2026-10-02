import fs from "node:fs";
import path from "node:path";

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
