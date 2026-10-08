// Files for the file tools (files_tools.ts): a file kept in a folder on its own ("To read/Paper.pdf",
// 20261008100000_folder_files.sql) or embedded in a note ("Work/Acme/contract.pdf"). paths.ts names
// them; this module moves, renames, deletes and restores files kept in folders, reads any file's
// bytes, turns them into text the AI can read (PDF, Word, Excel, PowerPoint, plain text), and writes
// new bytes: a new file, or a new version of one with the old one kept (20261008100100).
//
// Bytes are sealed with the account's key on the way into Storage and opened on the way out, in this
// request's memory only, like everything else the AI touches.

import type { FileMeta } from "../_shared/e2ee.ts";
import { isTextType, mimeOf } from "./notes.ts";
import { type Call, findFolder, iso, readCapped, ToolError, type Tx } from "./tools.ts";

export type FolderFileRow = { id: string; meta_ct: string; size: string; folder_id: string | null; trashed_at: Date | null; created_at: Date; updated_at: Date; content_version: number };
export type FolderFile = { id: string; name: string; type: string; bytes: number; folder_id: string | null; trashed_at: Date | null; created_at: Date; updated_at: Date; content_version: number };

/** What the AI sends and receives in one file: 10 MB (pane_limit 'ai_file_bytes'). In base64 that's
 *  about 13.4 MB of tool call, which the clients that take files at all accept. */
export const AI_FILE_BYTES = 10 * 1024 * 1024;
/** A sealed file's bytes beyond its content: "AMB2F", the key id, the nonce and the tag. */
export const SEALED_OVERHEAD = 5 + 16 + 12 + 16;
const MB = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

/** Every file kept in a folder (live or in Recently Deleted), for the path index. */
export async function folderFileRows(tx: Tx): Promise<FolderFileRow[]> {
  return await tx<FolderFileRow[]>`select id, meta_ct, size, folder_id, trashed_at, created_at, updated_at, content_version
    from public.attachments where folder_id is not null and deleted_at is null`;
}

/** A file as list shows it. */
export const fileOut = (path: string, f: { type: string; name: string; bytes: number; updated_at?: Date; trashed_at?: Date | null }) => ({
  path, type: "file", kind: mimeOf(f.type, f.name), bytes: f.bytes,
  ...(f.updated_at ? { updated: iso(f.updated_at) } : {}), ...(f.trashed_at ? { deleted: iso(f.trashed_at) } : {}),
});

const extOf = (name: string) => { const i = name.lastIndexOf("."); return i > 0 ? name.slice(i) : ""; };

// MARK: Kinds the app shows and the AI reads

/** The kinds a person can add (the app's Add File), by ending. Audio, video and EPUB come later. */
export const SUPPORTED = new Set([
  "pdf", "jpg", "jpeg", "png", "heic", "heif", "gif", "webp",
  "txt", "md", "markdown", "csv", "tsv", "json", "xml", "yaml", "yml", "html", "htm", "css", "js", "ts", "tsx", "jsx", "py", "swift", "sh", "sql", "rb", "go", "rs", "java", "kt", "c", "h", "cpp", "m",
  "docx", "xlsx", "pptx", "pages", "numbers", "key",
]);
/** Text the AI can change line by line, like a note. */
const TEXT_ENDINGS = new Set(["txt", "md", "markdown", "csv", "tsv", "json", "xml", "yaml", "yml", "html", "htm", "css", "js", "ts", "tsx", "jsx", "py", "swift", "sh", "sql", "rb", "go", "rs", "java", "kt", "c", "h", "cpp", "m"]);
const ending = (name: string) => extOf(name).slice(1).toLowerCase();
export const isTextFile = (name: string, type: string) => TEXT_ENDINGS.has(ending(name)) || isTextType(mimeOf(type, name));

/** UTType identifiers the apps use, by ending, for files the AI makes. */
export function utiOf(name: string, mime?: string): string {
  const e = ending(name);
  const byEnding: Record<string, string> = {
    pdf: "com.adobe.pdf", jpg: "public.jpeg", jpeg: "public.jpeg", png: "public.png", heic: "public.heic", gif: "com.compuserve.gif", webp: "org.webmproject.webp",
    txt: "public.plain-text", md: "net.daringfireball.markdown", markdown: "net.daringfireball.markdown", csv: "public.comma-separated-values-text", tsv: "public.tab-separated-values-text",
    json: "public.json", xml: "public.xml", yaml: "public.yaml", yml: "public.yaml", html: "public.html", htm: "public.html", css: "public.css", js: "com.netscape.javascript-source", ts: "public.typescript-source",
    py: "public.python-script", swift: "public.swift-source", sh: "public.shell-script", sql: "public.sql",
    docx: "org.openxmlformats.wordprocessingml.document", xlsx: "org.openxmlformats.spreadsheetml.sheet", pptx: "org.openxmlformats.presentationml.presentation",
    pages: "com.apple.iwork.pages.sffpages", numbers: "com.apple.iwork.numbers.sffnumbers", key: "com.apple.iwork.keynote.sffkey",
  };
  return byEnding[e] ?? (mime && TEXT_ENDINGS.has(e) ? "public.plain-text" : "public.data");
}

/** What the AI can read of a file without the bytes: text, or why there's none. */
export async function extract(bytes: Uint8Array, name: string, type: string): Promise<{ text: string; pages?: number } | { none: string }> {
  const e = ending(name);
  const mime = mimeOf(type, name);
  try {
    if (isTextFile(name, type)) return { text: new TextDecoder().decode(bytes) };
    if (mime === "application/pdf" || e === "pdf") {
      const { extractText, getDocumentProxy } = await import("npm:unpdf@1.3.2");
      const doc = await getDocumentProxy(new Uint8Array(bytes));
      const { totalPages, text } = await extractText(doc, { mergePages: false });
      const pages = (text as string[]).map((t, i) => `--- Page ${i + 1} ---\n${t.trim()}`).join("\n\n");
      if (!pages.replace(/--- Page \d+ ---/g, "").trim()) return { none: "This PDF has no text layer (a scan). Ask for raw: true to get the PDF itself." };
      return { text: pages, pages: totalPages };
    }
    if (e === "docx" || e === "xlsx" || e === "pptx") return { text: await officeText(bytes, e) };
    if (e === "pages" || e === "numbers" || e === "key") return { none: `Text can't be taken out of a ${e === "key" ? "Keynote" : e === "pages" ? "Pages" : "Numbers"} file here. Ask for raw: true to get the file itself.` };
  } catch (err) {
    return { none: `Its text couldn't be read (${(err as Error).message.slice(0, 80)}). Ask for raw: true to get the file itself.` };
  }
  return { none: "This kind of file has no text to read here. Ask for raw: true to get the file itself." };
}

/** Word, Excel and PowerPoint (Office Open XML): the text in reading order, cheaply, from the zip. */
async function officeText(bytes: Uint8Array, e: string): Promise<string> {
  const { unzipSync, strFromU8 } = await import("npm:fflate@0.8.2");
  const zip = unzipSync(bytes);
  const xml = (p: string) => zip[p] ? strFromU8(zip[p]) : "";
  const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  if (e === "docx") {
    return unescape(xml("word/document.xml").replace(/<w:tab\/>/g, "\t").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "")).replace(/\n{3,}/g, "\n\n").trim();
  }
  if (e === "pptx") {
    const slides = Object.keys(zip).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    return slides.map((p, i) => `--- Slide ${i + 1} ---\n${unescape(xml(p).replace(/<\/a:p>/g, "\n").replace(/<[^>]+>/g, "")).trim()}`).join("\n\n");
  }
  // xlsx: each sheet as tab-separated rows, shared strings put back.
  const shared = [...xml("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unescape(m[1].replace(/<[^>]+>/g, "")));
  const sheets = Object.keys(zip).filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p)).sort();
  return sheets.map((p, i) => {
    const rows = [...xml(p).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) =>
      [...r[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
        const v = c[2]?.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? c[2]?.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "";
        return /t="s"/.test(c[1]) ? shared[Number(v)] ?? "" : unescape(v);
      }).join("\t"));
    return `--- Sheet ${i + 1} ---\n${rows.join("\n")}`;
  }).join("\n\n");
}

// MARK: Bytes in Storage (the server's key; the row was read as the person, so the path is theirs)

function storage(path: string, init: RequestInit = {}) {
  const base = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return fetch(`${base}/storage/v1/object/${path}`, { ...init, headers: { authorization: `Bearer ${key}`, apikey: key, ...(init.headers ?? {}) } });
}
const objectPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

type FileRow = { id: string; user_id: string; meta_ct: string; size: string; storage_path: string; folder_id: string | null; content_version: number; updated_at: Date };

async function fileRow(tx: Tx, id: string, lock = false): Promise<FileRow> {
  const rows = lock
    ? await tx<FileRow[]>`select id, user_id, meta_ct, size, storage_path, folder_id, content_version, updated_at from public.attachments where id = ${id}::uuid and deleted_at is null for update`
    : await tx<FileRow[]>`select id, user_id, meta_ct, size, storage_path, folder_id, content_version, updated_at from public.attachments where id = ${id}::uuid and deleted_at is null`;
  if (!rows.length) throw new ToolError("That file was just deleted.");
  return rows[0];
}

/** A file's bytes and what it is, opened; refused over the AI's 10 MB. */
export async function readFile(tx: Tx, c: Call, id: string, path: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; meta: FileMeta; version: number }> {
  const f = await fileRow(tx, id);
  const meta = await c.v.openFileMeta(f.id, f.meta_ct).catch(() => { throw new ToolError(`${path} can't be opened here. The person can open it in Amber Notes.`); });
  const size = Math.max(Number(f.size) - SEALED_OVERHEAD, meta.size ?? 0);
  if (size > AI_FILE_BYTES) throw new ToolError(`${path} is ${MB(size)}. Files over 10 MB can't go through the AI connection; the person can open it in Amber Notes.`);
  const res = await storage(`files/${objectPath(f.storage_path)}`);
  if (!res.ok) { await res.body?.cancel(); throw new ToolError(`${path} isn't uploaded yet. Open Amber Notes on the device that added it so it can sync.`); }
  const sealed = await readCapped(res, AI_FILE_BYTES + SEALED_OVERHEAD).catch(() => { throw new ToolError(`${path} is over 10 MB.`); });
  try { return { bytes: await c.v.openFile(f.id, sealed), meta, version: f.content_version }; } catch { throw new ToolError(`${path} can't be opened here. The person can open it in Amber Notes.`); }
}

/** Writes a file's bytes: a new file in a folder (`folderId`), or a new version of an existing one
 *  (`id`), keeping the version it replaces (at most pane_limit 'file_versions'). */
export async function writeFile(tx: Tx, c: Call, o: { id?: string; folderId?: string | null; name: string; type: string; bytes: Uint8Array; path: string }): Promise<{ id: string; version: number; replaced?: boolean }> {
  if (!SUPPORTED.has(ending(o.name))) {
    throw new ToolError(`${o.path}: Amber Notes can't show .${ending(o.name) || "(no ending)"} files, so they can't be added. It takes PDF; JPEG, PNG, HEIC, GIF, WebP; text, Markdown, CSV, TSV, JSON, XML, YAML, HTML and code; Word, Excel, PowerPoint, Pages, Numbers and Keynote. Audio, video and EPUB come later.`);
  }
  if (o.bytes.length > AI_FILE_BYTES) throw new ToolError(`${o.path} would be ${MB(o.bytes.length)}. The AI can write files up to 10 MB; larger ones are added in Amber Notes (up to 100 MB).`);
  const sealedSize = o.bytes.length + SEALED_OVERHEAD;
  // Refused at the account's limit with how much is used (the error is the database's).
  await tx`select public.storage_room(${sealedSize}::bigint)`;
  const id = o.id ?? crypto.randomUUID();
  const meta_ct = await c.v.sealFileMeta(id, { name: o.name, type: o.type, size: o.bytes.length });
  const sealed = await c.v.sealFileBytes(id, new Uint8Array(o.bytes));
  if (o.id) {
    const f = await fileRow(tx, o.id, true);
    const [{ n }] = await tx<{ n: number }[]>`select coalesce(max(substring(storage_path from '\\.v([0-9]+)$')::int), 0) + 1 as n from public.attachment_versions where attachment_id = ${f.id}`;
    const versionPath = `${f.storage_path}.v${n}`;
    const copied = await storage("copy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bucketId: "files", sourceKey: f.storage_path, destinationKey: versionPath }) });
    await copied.body?.cancel();
    if (!copied.ok) throw new ToolError(`${o.path} isn't uploaded yet, so it can't be replaced. Open Amber Notes on the device that added it so it can sync.`);
    await tx`insert into public.attachment_versions (attachment_id, meta_ct, size, storage_path, client, made_at)
      values (${f.id}, ${f.meta_ct}, ${f.size}, ${versionPath}, ${c.ctx.client}, ${f.updated_at})`;
    // Only the newest versions stay.
    const gone = await tx<{ storage_path: string }[]>`delete from public.attachment_versions where attachment_id = ${f.id} and id not in (
      select id from public.attachment_versions where attachment_id = ${f.id} order by id desc limit 10) returning storage_path`;
    await upload(f.storage_path, sealed, o.path);
    if (gone.length) await removeObjects(gone.map((g) => g.storage_path));
    await tx`update public.attachments set meta_ct = ${meta_ct}, size = ${sealed.length}, content_version = content_version + 1, updated_at = now() where id = ${f.id}`;
    return { id: f.id, version: f.content_version + 1, replaced: true };
  }
  const [{ uid }] = await tx<{ uid: string }[]>`select auth.uid()::text as uid`;
  const storagePath = `${uid}/${id}`;
  await upload(storagePath, sealed, o.path);
  await tx`insert into public.attachments (id, meta_ct, size, storage_path, folder_id) values (${id}, ${meta_ct}, ${sealed.length}, ${storagePath}, ${o.folderId ?? null})`;
  return { id, version: 0 };
}

async function upload(path: string, sealed: Uint8Array, shown: string) {
  const res = await storage(`files/${objectPath(path)}`, { method: "POST", headers: { "content-type": "application/octet-stream", "x-upsert": "true" }, body: new Uint8Array(sealed) });
  await res.body?.cancel();
  if (!res.ok) throw new ToolError(`${shown} couldn't be stored (${res.status}). Nothing was changed; try again.`);
}

async function removeObjects(paths: string[]) {
  const res = await storage("files", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ prefixes: paths }) });
  await res.body?.cancel();
}

/** Earlier versions of a file, newest first. */
export async function fileVersions(tx: Tx, c: Call, id: string, limit: number) {
  const rows = await tx<{ id: string; meta_ct: string; size: string; client: string | null; made_at: Date; replaced_at: Date }[]>`
    select id, meta_ct, size, client, made_at, replaced_at from public.attachment_versions where attachment_id = ${id} order by id desc limit ${limit}`;
  return await Promise.all(rows.map(async (v) => {
    const meta = await c.v.openFileMeta(id, v.meta_ct).catch(() => null);
    return { version: Number(v.id), ...(meta ? { name: meta.name } : {}), bytes: Math.max(Number(v.size) - SEALED_OVERHEAD, 0), made_by: v.client, made: iso(v.made_at), replaced: iso(v.replaced_at) };
  }));
}

/** Puts an earlier version back; what it replaces becomes a version too. */
export async function restoreFileVersion(tx: Tx, c: Call, id: string, version: number, path: string) {
  const [v] = await tx<{ meta_ct: string; storage_path: string }[]>`select meta_ct, storage_path from public.attachment_versions where id = ${version} and attachment_id = ${id}`;
  if (!v) throw new ToolError(`No version ${version} of ${path}. Use history.`);
  const res = await storage(`files/${objectPath(v.storage_path)}`);
  if (!res.ok) { await res.body?.cancel(); throw new ToolError(`Version ${version} of ${path} is gone from storage.`); }
  const sealed = new Uint8Array(await res.arrayBuffer());
  const bytes = await c.v.openFile(id, sealed);
  const meta = await c.v.openFileMeta(id, v.meta_ct);
  return await writeFile(tx, c, { id, name: meta.name, type: meta.type, bytes, path });
}

// MARK: Files kept in folders: move, rename, delete, restore

/** Moves a file to a folder ("Archive/", made if needed) or renames it ("To read/New name.pdf"),
 *  or both. The name is sealed again; the bytes don't change. */
export async function moveFile(tx: Tx, c: Call, f: FolderFile, to: string): Promise<void> {
  const rename = /\.[A-Za-z0-9]{1,10}$/.test(to) && !to.endsWith("/") && !/\.md$/i.test(to);
  const parts = to.replace(/\/+$/, "").split("/").map((p) => p.trim()).filter(Boolean);
  const name = rename ? parts.pop()! : f.name;
  if (rename && extOf(name).toLowerCase() !== extOf(f.name).toLowerCase()) {
    throw new ToolError(`Keep the file's ending (${extOf(f.name) || "none"}): renaming doesn't change what kind of file it is.`);
  }
  if (!name || name.length > 255) throw new ToolError("A file's name is 1 to 255 characters.");
  const folder = parts.length ? (await findFolder(tx, c.v, parts.join("/"), true)).id : f.folder_id;
  const row = await fileRow(tx, f.id, true);
  const meta = await c.v.openFileMeta(f.id, row.meta_ct);
  const meta_ct = name === meta.name ? null : await c.v.sealFileMeta(f.id, { ...meta, name });
  await tx`update public.attachments set folder_id = ${folder}, meta_ct = coalesce(${meta_ct}, meta_ct), updated_at = now() where id = ${f.id}`;
}

/** To Recently Deleted (30 days), like a note. */
export async function trashFile(tx: Tx, f: FolderFile) {
  if (!f.trashed_at) await tx`update public.attachments set trashed_at = now(), updated_at = now() where id = ${f.id}`;
}

/** Back from Recently Deleted, into its folder, or Notes if that folder is gone. */
export async function restoreFile(tx: Tx, c: Call, f: FolderFile) {
  const [live] = await tx<{ id: string }[]>`select id from public.folders where id = ${f.folder_id} and deleted_at is null`;
  const folder = live ? live.id : (await findFolder(tx, c.v, "Notes", true)).id;
  await tx`update public.attachments set trashed_at = null, folder_id = ${folder}, updated_at = now() where id = ${f.id}`;
}
