// Files that sit in a folder on their own, next to its notes and apps (20261007165000_folder_files.sql):
// "To read/Paper.pdf". The file-like tool set (files_tools.ts) reads, lists, moves, renames, deletes
// and restores them through here. A file only a note embeds has no folder and stays "pane-file:<id>".
// Names and types are sealed (meta_ct), so every lookup opens them in memory, folder by folder.

import type { FileMeta } from "../_shared/e2ee.ts";
import { mimeOf } from "./notes.ts";
import { type Call, type FolderRow, folders, findFolder, iso, pathOf, ToolError, type Tx } from "./tools.ts";

export type FolderFile = {
  id: string;
  /** The name it's listed under: its own, or "Paper (2).pdf" for a second "Paper.pdf" in one folder. */
  name: string;
  meta: FileMeta;
  bytes: number;
  folder_id: string | null;
  trashed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type Row = { id: string; meta_ct: string; size: string; folder_id: string | null; trashed_at: Date | null; created_at: Date; updated_at: Date };
const COLUMNS = (tx: Tx) => tx`id, meta_ct, size, folder_id, trashed_at, created_at, updated_at`;

const extOf = (name: string) => { const i = name.lastIndexOf("."); return i > 0 ? name.slice(i) : ""; };
const SEALED_FILE_OVERHEAD = 5 + 16 + 12 + 16;

async function open(c: Call, rows: Row[]): Promise<FolderFile[]> {
  const out: FolderFile[] = [];
  for (const r of rows) {
    const meta = await c.v.openFileMeta(r.id, r.meta_ct).catch(() => null);
    if (!meta) continue;
    const name = meta.name.replace(/\//g, "∕").trim() || "file";
    out.push({ id: r.id, name, meta, bytes: meta.size ?? Math.max(Number(r.size) - SEALED_FILE_OVERHEAD, 0), folder_id: r.folder_id, trashed_at: r.trashed_at, created_at: r.created_at, updated_at: r.updated_at });
  }
  return out;
}

/** The names files are listed under: oldest first keeps its name, a later one with the same name in
 *  the same folder reads "Paper (2).pdf". Paths stay stable while nothing older is renamed or deleted. */
export function named(files: FolderFile[]): FolderFile[] {
  const seen = new Map<string, number>();
  return [...files].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at) || (a.id < b.id ? -1 : 1)).map((f) => {
    const key = `${f.folder_id}|${f.name.toLowerCase()}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n === 1) return f;
    const ext = extOf(f.name);
    return { ...f, name: `${f.name.slice(0, f.name.length - ext.length)} (${n})${ext}` };
  });
}

/** The files in one folder, newest first. With `trashed`, those in Recently Deleted too. */
export async function filesIn(tx: Tx, c: Call, folderId: string, trashed = false): Promise<FolderFile[]> {
  const rows = await tx<Row[]>`select ${COLUMNS(tx)} from public.attachments
    where folder_id = ${folderId} and deleted_at is null ${trashed ? tx`` : tx`and trashed_at is null`}`;
  return named(await open(c, rows)).sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at));
}

/** Files in Recently Deleted, newest first. */
export async function trashedFiles(tx: Tx, c: Call): Promise<FolderFile[]> {
  const rows = await tx<Row[]>`select ${COLUMNS(tx)} from public.attachments
    where folder_id is not null and deleted_at is null and trashed_at is not null order by trashed_at desc limit 100`;
  return named(await open(c, rows));
}

/** How many live files each folder holds (no names needed). */
export async function fileCounts(tx: Tx): Promise<Map<string, number>> {
  const rows = await tx<{ folder_id: string; n: number }[]>`select folder_id, count(*)::int as n from public.attachments
    where folder_id is not null and deleted_at is null and trashed_at is null group by folder_id`;
  return new Map(rows.map((r) => [r.folder_id, r.n]));
}

export const filePath = (f: FolderFile, all: FolderRow[]) => `${pathOf(f.folder_id, all)}/${f.name}`;

/** A file as list shows it. */
export const fileEntry = (f: FolderFile, all: FolderRow[]) => ({
  path: filePath(f, all), id: f.id, type: mimeOf(f.meta.type, f.meta.name), bytes: f.bytes, updated: iso(f.updated_at),
  ...(f.trashed_at ? { deleted: iso(f.trashed_at) } : {}),
});

/** Looks like a file's path: its last part has an extension that isn't a note's or an app's. */
export const looksLikeFile = (path: string) => /\.[A-Za-z0-9]{1,10}$/.test(path) && !/\.(md|app)$/i.test(path);

/** The file at "<folder path>/<name>", or null when there's none (the path may be a note or folder). */
export async function fileAt(tx: Tx, c: Call, path: string, trashed = false): Promise<FolderFile | null> {
  const parts = path.split("/").map((p) => p.trim()).filter(Boolean);
  const name = parts.pop();
  if (!name || !parts.length) return null;
  const all = await folders(tx, c.v);
  const dir = parts.join("/").toLowerCase();
  const folder = all.find((f) => pathOf(f.id, all).toLowerCase() === dir);
  if (!folder) return null;
  return (await filesIn(tx, c, folder.id, trashed)).find((f) => f.name.toLowerCase() === name.toLowerCase()) ?? null;
}

/** A file in a folder by its id (null for one that only a note embeds, or none). */
export async function folderFileById(tx: Tx, c: Call, id: string): Promise<FolderFile | null> {
  const [r] = await tx<Row[]>`select ${COLUMNS(tx)} from public.attachments where id = ${id}::uuid and deleted_at is null`;
  if (!r?.folder_id) return null;
  return (await filesIn(tx, c, r.folder_id, true)).find((f) => f.id === id) ?? null;
}

/** Live files whose name has every word of the query, for search. */
export async function filesNamed(tx: Tx, c: Call, query: string, limit: number): Promise<FolderFile[]> {
  const words = query.toLowerCase().replace(/"/g, "").split(/\s+/).filter((w) => w && !w.startsWith("-") && w !== "or");
  if (!words.length) return [];
  const rows = await tx<Row[]>`select ${COLUMNS(tx)} from public.attachments
    where folder_id is not null and deleted_at is null and trashed_at is null order by updated_at desc limit 2000`;
  return named(await open(c, rows)).filter((f) => words.every((w) => f.name.toLowerCase().includes(w))).slice(0, limit);
}

/** Moves a file to a folder ("Archive/", made if needed) or renames it ("To read/New name.pdf"),
 *  or both. The name is sealed again; the bytes don't change. */
export async function moveFile(tx: Tx, c: Call, f: FolderFile, to: string): Promise<{ moved: string }> {
  const rename = looksLikeFile(to) && !to.endsWith("/");
  const parts = to.replace(/\/+$/, "").split("/").map((p) => p.trim()).filter(Boolean);
  const name = rename ? parts.pop()! : f.meta.name;
  const dir = parts.join("/");
  const all = await folders(tx, c.v);
  const target = dir ? await findFolder(tx, c.v, dir, true) : all.find((x) => x.id === f.folder_id)!;
  if (!name || name.length > 255) throw new ToolError("A file's name is 1 to 255 characters.");
  if (rename && extOf(name).toLowerCase() !== extOf(f.meta.name).toLowerCase()) {
    throw new ToolError(`Keep the file's ending (${extOf(f.meta.name) || "none"}): renaming doesn't change what kind of file it is.`);
  }
  const clash = (await filesIn(tx, c, target.id)).find((x) => x.id !== f.id && x.name.toLowerCase() === name.toLowerCase());
  if (clash) throw new ToolError(`"${pathOf(target.id, await folders(tx, c.v))}/${clash.name}" already exists. Pick another name.`);
  const meta_ct = name === f.meta.name ? null : await c.v.sealFileMeta(f.id, { ...f.meta, name });
  await tx`update public.attachments set folder_id = ${target.id}, meta_ct = coalesce(${meta_ct}, meta_ct), updated_at = now() where id = ${f.id}`;
  const moved = (await filesIn(tx, c, target.id)).find((x) => x.id === f.id)!;
  return { moved: filePath(moved, await folders(tx, c.v)) };
}

/** To Recently Deleted (30 days), like a note. */
export async function trashFile(tx: Tx, c: Call, f: FolderFile) {
  const all = await folders(tx, c.v);
  if (!f.trashed_at) await tx`update public.attachments set trashed_at = now(), updated_at = now() where id = ${f.id}`;
  return { deleted: filePath(f, all), moved_to: "Recently Deleted", restore_with: "restore" };
}

/** Back from Recently Deleted, into its folder, or Notes if that folder is gone. */
export async function restoreFile(tx: Tx, c: Call, f: FolderFile) {
  if (!f.trashed_at) return { path: filePath(f, await folders(tx, c.v)), already_restored: true };
  const live = (await folders(tx, c.v)).some((x) => x.id === f.folder_id);
  const folder = live ? f.folder_id! : (await findFolder(tx, c.v, "Notes", true)).id;
  await tx`update public.attachments set trashed_at = null, folder_id = ${folder}, updated_at = now() where id = ${f.id}`;
  const back = (await filesIn(tx, c, folder)).find((x) => x.id === f.id)!;
  return { restored: filePath(back, await folders(tx, c.v)) };
}
