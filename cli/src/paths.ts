// Where a note lives on disk. A note's remote path ("Work/Acme.md") is its folder and its title, as
// the server's files tools name it; the local file keeps that path unless another note already has
// it (two notes may share a title), then the id's first characters tell them apart.
import { titleOf } from "../../supabase/functions/mcp/notes.ts";

export { titleOf };

/** Files the sync looks at: markdown, outside hidden folders (.amber, .obsidian, .git) and app folders. */
export function isSyncable(rel: string): boolean {
  if (!/\.md$/i.test(rel)) return false;
  return rel.split("/").every((part, i, all) => part && !part.startsWith(".") && (i === all.length - 1 || !/\.app$/i.test(part)));
}

/** The path a note gets on disk: its remote path, or, when that's taken, the same with its id. */
export function localPathFor(remotePath: string, id: string, taken: (lowercasePath: string) => boolean): string {
  if (!taken(remotePath.toLowerCase())) return remotePath;
  return remotePath.replace(/\.md$/i, ` (${id.slice(0, 8)}).md`);
}

export const stemOf = (rel: string) => rel.split("/").pop()!.replace(/\.md$/i, "");
export const dirOf = (rel: string) => rel.split("/").slice(0, -1).join("/");

/** "Work/Acme.md" → "Work/Acme (conflict 2026-10-06).md", numbered when that exists too. */
export function conflictPath(rel: string, date: string, exists: (lowercasePath: string) => boolean): string {
  const base = rel.replace(/\.md$/i, "");
  for (let n = 1; ; n++) {
    const p = `${base} (conflict ${date}${n > 1 ? ` ${n}` : ""}).md`;
    if (!exists(p.toLowerCase())) return p;
  }
}

/** The text with its first line (the title in Amber) set to `title`, keeping a "# " heading mark. */
export function retitle(text: string, title: string): string {
  const lines = text.split("\n");
  const k = lines.findIndex((l) => l.trim());
  if (k < 0) return `${title}\n${text}`;
  const m = lines[k].match(/^(\s*#{1,6}\s+)/);
  lines[k] = `${m ? m[1] : ""}${title}`;
  return lines.join("\n");
}

/** A new local file as a note: in Amber the first line is the title, so a file whose first line
 *  isn't its name gets its name as a first line. */
export function withTitle(stem: string, text: string): string {
  if (titleOf(text) === stem) return text;
  return text.trim() ? `${stem}\n\n${text}` : `${stem}\n`;
}

/** YYYY-MM-DD in local time. */
export const day = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
