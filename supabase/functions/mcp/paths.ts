// The account as files, for the file tools (files_tools.ts): every folder, note, sub-note and app
// gets one path, and a path finds one thing. Paths only, never ids:
//   folder        "Work/Clients/"
//   note          "Work/Acme.md"
//   its sub-notes "Work/Acme/Agenda.md"       (the folder with the note's name)
//   its files     "Work/Acme/contract.pdf"    (files the note embeds; found when that folder is read)
//   its app       "Work/Acme.app/src/App.tsx", "Work/Acme.app/data.json"
//   a file kept in a folder on its own "To read/Paper.pdf" (folder_files.ts)
//   deleted       "Recently Deleted/Acme.md"
// Two things with one name in one place: the oldest (created first, then by id) keeps the name,
// the next ones get " (2)", " (3)" before the extension. That stays stable until something older
// is restored there. A real folder and a note's folder with the same name ("Work/Acme/" and
// "Work/Acme.md") are one folder.
//
// Building this needs every note's title and folder's name, which are sealed. They're kept per
// account in one sealed box (mcp_title_index, with each note's version), so a call opens that box
// and only the titles that changed since, not every note's head.

import { type FolderRow, type Note, type NoteRow, type Tx, type Call, ToolError } from "./tools.ts";
import { type FolderFile, folderFileRows, type FolderFileRow } from "./folder_files.ts";

export const DELETED = "Recently Deleted/";

export type Entry =
  | { kind: "folder"; path: string; folder: FolderRow }
  | { kind: "note"; path: string; note: Note; app: boolean }
  | { kind: "file"; path: string; file: FolderFile };

/** What one build cost, for the Server-Timing header and the performance notes. */
export type PathTiming = { rows: number; opened: number; dbMs: number; openMs: number; buildMs: number; cached: boolean };

type Light = Omit<NoteRow, "head_ct" | "body_ct"> & { locked: boolean };
/** The sealed index: note id → [version, title]; folder id → [its sealed name, the name]; a file
 *  in a folder → [its sealed meta, its name, its type]. */
type Index = { v: 1; notes: Record<string, [string, string]>; folders: Record<string, [string, string]>; files?: Record<string, [string, string, string, number?]> };

const UNREADABLE = "(this note can't be opened here)";
export const safeName = (t: string) => t.replace(/\//g, "∕").replace(/[\r\n]+/g, " ").trim() || "Untitled";
const lower = (s: string) => s.toLowerCase();

export class Paths {
  /** path (lowercase) → entry. Folders end in "/". */
  private byPath = new Map<string, Entry>();
  private notePaths = new Map<string, string>();
  private folderPaths = new Map<string, string>();
  private filePaths = new Map<string, string>();
  /** directory (lowercase, "" for the top) → its entries. */
  private dirs = new Map<string, Entry[]>();
  private constructor(readonly timing: PathTiming) {}

  static async load(tx: Tx, c: Call): Promise<Paths> {
    const t0 = performance.now();
    const [rows, frows, apps, stored, fileRows] = await Promise.all([
      tx<Light[]>`select id, folder_id, parent_id, is_pinned, created_at, updated_at, trashed_at, version, locked_body is not null as locked
        from public.notes where deleted_at is null`,
      tx<{ id: string; name_ct: string; parent_id: string | null; sort_index: number; created_at: Date }[]>`
        select id, name_ct, parent_id, sort_index, created_at from public.folders where deleted_at is null`,
      tx<{ note_id: string }[]>`select note_id from public.note_pages where page_ct is not null or draft_ct is not null`,
      tx<{ index_ct: string }[]>`select index_ct from public.mcp_title_index`,
      folderFileRows(tx),
    ]);
    const dbMs = performance.now() - t0;
    const t1 = performance.now();
    let index: Index = { v: 1, notes: {}, folders: {} };
    const cached = stored.length > 0 && !c.ctx.cold;
    if (cached) { try { index = JSON.parse(await c.v.openTitleIndex(stored[0].index_ct)); } catch { /* another key's, or old: rebuilt */ } }
    let opened = 0, changed = false;
    const stale = rows.filter((r) => index.notes[r.id]?.[0] !== String(r.version)).map((r) => r.id);
    for (let i = 0; i < stale.length; i += 1000) {
      const chunk = stale.slice(i, i + 1000);
      const heads = await tx<{ id: string; head_ct: string; version: string }[]>`select id, head_ct, version from public.notes where id = any(${chunk}::uuid[])`;
      await Promise.all(heads.map(async (h) => {
        let title: string;
        try { title = (await c.v.openHead(h.id, h.head_ct)).title; } catch { title = UNREADABLE; }
        index.notes[h.id] = [String(h.version), title];
        opened++;
      }));
      changed = true;
    }
    const folders: FolderRow[] = await Promise.all(frows.map(async (f) => {
      let name = index.folders[f.id]?.[0] === f.name_ct ? index.folders[f.id][1] : null;
      if (name === null) {
        name = await c.v.openFolder(f.id, f.name_ct).catch(() => "(can't be opened here)");
        index.folders[f.id] = [f.name_ct, name];
        opened++;
        changed = true;
      }
      return { id: f.id, name, parent_id: f.parent_id, sort_index: Number(f.sort_index) };
    }));
    // Files kept in folders: their names are sealed too.
    const files: FolderFile[] = [];
    index.files ??= {};
    for (const f of fileRows) {
      let known = index.files[f.id]?.[0] === f.meta_ct ? index.files[f.id] : null;
      if (!known) {
        const meta = await c.v.openFileMeta(f.id, f.meta_ct).catch(() => null);
        known = [f.meta_ct, meta ? meta.name : "(this file can't be opened here)", meta?.type ?? "public.data", meta?.size];
        index.files[f.id] = known;
        opened++;
        changed = true;
      }
      files.push(fileOf(f, known[1], known[2], known[3]));
    }
    const liveFiles = new Set(fileRows.map((f) => f.id));
    for (const id of Object.keys(index.files)) if (!liveFiles.has(id)) { delete index.files[id]; changed = true; }
    // What's gone leaves the index too.
    const live = new Set(rows.map((r) => r.id)), liveFolders = new Set(frows.map((f) => f.id));
    for (const id of Object.keys(index.notes)) if (!live.has(id)) { delete index.notes[id]; changed = true; }
    for (const id of Object.keys(index.folders)) if (!liveFolders.has(id)) { delete index.folders[id]; changed = true; }
    if (changed && !c.ctx.cold) {
      const sealed = await c.v.sealTitleIndex(JSON.stringify(index));
      await tx`insert into public.mcp_title_index (index_ct) values (${sealed})
        on conflict (user_id) do update set index_ct = excluded.index_ct, updated_at = now()`;
    }
    const openMs = performance.now() - t1;
    const t2 = performance.now();
    const hasApp = new Set(apps.map((a) => a.note_id));
    const notes: Note[] = rows.map(({ locked, ...r }) => ({ ...r, head_ct: "", locked_body: locked ? "locked" : null, version: String(r.version), title: index.notes[r.id]?.[1] ?? UNREADABLE }));
    const created = new Map(frows.map((f) => [f.id, +new Date(f.created_at)]));
    const p = new Paths({ rows: rows.length, opened, dbMs: Math.round(dbMs), openMs: Math.round(openMs), buildMs: 0, cached });
    p.build(folders, notes, hasApp, created, files);
    p.timing.buildMs = Math.round(performance.now() - t2);
    return p;
  }

  private build(folders: FolderRow[], notes: Note[], hasApp: Set<string>, folderCreated: Map<string, number>, files: FolderFile[] = []) {
    const byId = new Map(notes.map((n) => [n.id, n]));
    const folderById = new Map(folders.map((f) => [f.id, f]));
    // Where each note lives: a live sub-note in its live parent's folder; everything else in its folder.
    const parentOf = (n: Note) => {
      const p = n.parent_id ? byId.get(n.parent_id) : undefined;
      return p && !!p.trashed_at === !!n.trashed_at ? p : undefined;
    };
    // Directories are named top-down: a folder's or note's directory path depends on its parent's.
    type Node = { kind: "folder"; f: FolderRow; created: number } | { kind: "note"; n: Note; created: number };
    const kids = new Map<string, Node[]>(); // container key → nodes; "f:<id>", "n:<id>", "root", "trash"
    const push = (k: string, node: Node) => (kids.get(k) ?? kids.set(k, []).get(k)!).push(node);
    for (const f of folders) push(f.parent_id && folderById.has(f.parent_id) ? `f:${f.parent_id}` : "root", { kind: "folder", f, created: folderCreated.get(f.id) ?? 0 });
    for (const n of notes) {
      const p = parentOf(n);
      const k = p ? `n:${p.id}` : n.trashed_at ? "trash" : n.folder_id && folderById.has(n.folder_id) ? `f:${n.folder_id}` : "root";
      push(k, { kind: "note", n, created: +new Date(n.created_at) });
    }
    // Files kept in folders, by container, oldest first (who keeps the plain name).
    const fileKids = new Map<string, FolderFile[]>();
    for (const f of files) {
      const k = f.trashed_at ? "trash" : f.folder_id && folderById.has(f.folder_id) ? `f:${f.folder_id}` : "root";
      (fileKids.get(k) ?? fileKids.set(k, []).get(k)!).push(f);
    }
    const seen = new Set<string>();
    const walk = (containers: string[], dir: string, depth: number) => {
      if (depth > 40) return;
      const nodes = containers.flatMap((k) => kids.get(k) ?? []);
      // Real folders first, then notes, each oldest first: who keeps the plain name.
      nodes.sort((a, b) => a.kind !== b.kind ? (a.kind === "folder" ? -1 : 1) : a.created - b.created || (a.kind === "folder" ? a.f.id : (a as { n: Note }).n.id).localeCompare(b.kind === "folder" ? b.f.id : (b as { n: Note }).n.id));
      const taken = new Set<string>();
      const name = (base: string, ext: string) => {
        let k = 1, out = base + ext;
        while (taken.has(lower(out))) out = `${base} (${++k})${ext}`;
        taken.add(lower(out));
        return out;
      };
      // Folders and notes' folders share names: "Acme/" (a folder) and "Acme.md" (a note) are one directory.
      const folderDirs = new Map<string, string[]>(); // lowercase name → containers
      const order: { name: string; containers: string[] }[] = [];
      for (const node of nodes) {
        if (node.kind === "folder") {
          if (seen.has(`f:${node.f.id}`)) continue;
          seen.add(`f:${node.f.id}`);
          const nm = name(safeName(node.f.name), "/").slice(0, -1);
          const path = `${dir}${nm}/`;
          const e: Entry = { kind: "folder", path, folder: node.f };
          this.byPath.set(lower(path), e);
          this.folderPaths.set(node.f.id, path);
          this.dirs.get(lower(dir))?.push(e) ?? this.dirs.set(lower(dir), [e]);
          folderDirs.set(lower(nm), [`f:${node.f.id}`]);
          order.push({ name: nm, containers: folderDirs.get(lower(nm))! });
        }
      }
      for (const node of nodes) {
        if (node.kind !== "note" || seen.has(`n:${node.n.id}`)) continue;
        seen.add(`n:${node.n.id}`);
        const base = safeName(node.n.title);
        // A note's name must not take a name already used by another note ("Acme.md" twice), but
        // it may share one with a folder ("Acme/").
        let k = 1, nm = base;
        while (taken.has(lower(nm + ".md"))) nm = `${base} (${++k})`;
        taken.add(lower(nm + ".md"));
        const path = `${dir}${nm}.md`;
        const e: Entry = { kind: "note", path, note: node.n, app: hasApp.has(node.n.id) };
        this.byPath.set(lower(path), e);
        this.notePaths.set(node.n.id, path);
        this.dirs.get(lower(dir))?.push(e) ?? this.dirs.set(lower(dir), [e]);
        const shared = folderDirs.get(lower(nm));
        if (shared) shared.push(`n:${node.n.id}`);
        else if (kids.has(`n:${node.n.id}`)) order.push({ name: nm, containers: [`n:${node.n.id}`] });
      }
      // Files share the folder's names with its notes: "Paper.pdf", then "Paper (2).pdf".
      const here = containers.flatMap((k) => fileKids.get(k) ?? []).sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at) || a.id.localeCompare(b.id));
      for (const f of here) {
        if (seen.has(`a:${f.id}`)) continue;
        seen.add(`a:${f.id}`);
        const full = safeName(f.name);
        const dot = full.lastIndexOf(".");
        const nm = dot > 0 ? name(full.slice(0, dot), full.slice(dot)) : name(full, "");
        const path = `${dir}${nm}`;
        const e: Entry = { kind: "file", path, file: f };
        this.byPath.set(lower(path), e);
        this.filePaths.set(f.id, path);
        this.dirs.get(lower(dir))?.push(e) ?? this.dirs.set(lower(dir), [e]);
      }
      for (const o of order) walk(o.containers, `${dir}${o.name}/`, depth + 1);
    };
    walk(["root"], "", 0);
    walk(["trash"], DELETED, 0);
  }

  /** The entry at a path ("Work/", "Work/Acme.md"), or undefined. */
  at(path: string): Entry | undefined {
    const p = path.replace(/^\/+/, "");
    return this.byPath.get(lower(p)) ?? (p.endsWith("/") ? undefined : this.byPath.get(lower(p + "/")));
  }
  noteAt(path: string): Note | undefined {
    const e = this.at(path);
    return e?.kind === "note" ? e.note : undefined;
  }
  pathOf(noteId: string): string | undefined { return this.notePaths.get(noteId); }
  /** A file kept in a folder: its path, by its id. */
  filePathOf(fileId: string): string | undefined { return this.filePaths.get(fileId); }
  fileAt(path: string): FolderFile | undefined { const e = this.at(path); return e?.kind === "file" ? e.file : undefined; }
  folderPathOf(folderId: string | null): string { return folderId ? this.folderPaths.get(folderId) ?? "" : ""; }
  note(noteId: string): Entry | undefined { const p = this.notePaths.get(noteId); return p ? this.byPath.get(lower(p)) : undefined; }
  hasApp(noteId: string): boolean { const e = this.note(noteId); return e?.kind === "note" && e.app; }
  /** A directory's entries: a folder's, a note's sub-notes, or the top ("" ). */
  children(dir: string): Entry[] { return this.dirs.get(lower(dir.replace(/^\/+/, ""))) ?? []; }
  /** Whether a directory exists (a folder, or a note's folder with something in it). */
  isDir(dir: string): boolean { return dir === "" || this.dirs.has(lower(dir)) || this.at(dir)?.kind === "folder"; }
  /** Every entry: folders, notes and files kept in folders. */
  all(): Entry[] { return [...this.byPath.values()]; }
  /** The note whose folder this directory is ("Work/Acme/" → "Work/Acme.md"), if any. */
  noteOfDir(dir: string): Note | undefined { return this.noteAt(dir.replace(/\/+$/, "") + ".md"); }

  /** Titles that match, for "no note at …" hints. */
  similar(path: string): string[] {
    const want = lower(path.replace(/\/+$/, "").split("/").pop()!.replace(/\.md$/i, ""));
    return this.all().filter((e) => e.kind === "note" && lower(safeName(e.note.title)) === want).map((e) => e.path).slice(0, 5);
  }

  /** A path, or an error that helps find the right one. */
  must(path: string): Entry {
    const e = this.at(path);
    if (e) return e;
    const like = this.similar(path);
    throw new ToolError(`Nothing at "${path}".${like.length ? ` Did you mean ${like.map((p) => `"${p}"`).join(", ")}?` : " Use list or search to find it."}`);
  }
}

function fileOf(r: FolderFileRow, name: string, type: string, size?: number): FolderFile {
  // Its own size, sealed with its name; else the stored (sealed) size less the box's overhead.
  return { id: r.id, name, type, bytes: size ?? Math.max(Number(r.size) - 49, 0), folder_id: r.folder_id, trashed_at: r.trashed_at, created_at: r.created_at, updated_at: r.updated_at, content_version: r.content_version };
}
