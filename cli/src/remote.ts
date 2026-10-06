// The account as the sync sees it: notes by id, each with a path, a version and its text. Two
// implementations: the files tools (list, fetch, create, edit, write, move, delete) and the classic
// tools production runs today (list_notes, read_note, create_note, edit_note, …).
import type { Mcp } from "./client.ts";
import { ToolFailed } from "./client.ts";
import { dirOf, retitle, stemOf } from "./paths.ts";

export type RemoteNote = { id: string; path: string; version: string; locked?: boolean; app?: boolean };
export type Read = { text: string; version: string; path: string };

/** The note changed in Amber since the version the change was based on. */
export class Changed extends Error {}

export interface Remote {
  readonly kind: "files" | "classic";
  list(): Promise<RemoteNote[]>;
  read(id: string): Promise<Read>;
  /** A new note from a file at `path`; `inside` makes it a sub-note of that note. */
  create(path: string, text: string, inside?: string): Promise<string>;
  /** Replaces the text, if the note is still at `version` (whose text was `base`). */
  update(id: string, base: string, text: string, version: string): Promise<void>;
  move(id: string, from: string, to: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export function remoteFor(mcp: Mcp): Remote {
  if (["list", "fetch", "create", "edit", "write", "move", "delete"].every((t) => mcp.tools.includes(t))) return new FilesRemote(mcp);
  if (["list_notes", "read_note", "create_note", "edit_note", "move_note", "delete_note"].every((t) => mcp.tools.includes(t))) return new ClassicRemote(mcp);
  throw new Error(`The server offers neither the files tools nor the classic tools (it has: ${mcp.tools.join(", ")}).`);
}

const changed = (e: unknown) => e instanceof ToolFailed && /changed since/i.test(e.message);

/** One exact search-and-replace that turns `base` into `text`, if a short unique one exists. */
export function editFor(base: string, text: string): { old_text: string; new_text: string } | null {
  if (!base || base === text) return null;
  let p = 0;
  while (p < base.length && p < text.length && base[p] === text[p]) p++;
  let s = 0;
  while (s < base.length - p && s < text.length - p && base[base.length - 1 - s] === text[text.length - 1 - s]) s++;
  // Whole lines around the change, widened until they occur once.
  let start = base.lastIndexOf("\n", p - 1) + 1;
  let end = base.indexOf("\n", base.length - s);
  if (end < 0) end = base.length;
  for (let tries = 0; tries < 6; tries++) {
    const old = base.slice(start, end);
    if (old.trim() && base.indexOf(old) === base.lastIndexOf(old)) {
      if (old.length > base.length / 2) return null;
      return { old_text: old, new_text: text.slice(start, text.length - (base.length - end)) };
    }
    if (start === 0 && end === base.length) return null;
    start = start > 0 ? base.lastIndexOf("\n", start - 2) + 1 : 0;
    const next = base.indexOf("\n", end + 1);
    end = end < base.length ? (next < 0 ? base.length : next) : end;
  }
  return null;
}

/** Reads a long text in pages: `page(from)` gives one page and where the next starts, if anywhere. */
async function paged(page: (from?: number) => Promise<{ text: string; next?: number }>): Promise<string> {
  const parts: string[] = [];
  let at: number | undefined;
  for (let i = 0; i < 1000; i++) {
    const r = await page(at);
    parts.push(r.text);
    if (r.next === undefined) return parts.join("\n");
    at = r.next;
  }
  throw new Error("note too long to read");
}

class FilesRemote implements Remote {
  readonly kind = "files";
  constructor(private mcp: Mcp) {}

  async list() {
    const r = await this.mcp.call("list", { all: true });
    if (!Array.isArray(r?.notes)) throw new Error("This server's list tool can't list every note at once (list { all: true }); the sync needs it. Update the server.");
    return (r.notes as { id: string; path: string; version: number; locked?: boolean; app?: boolean }[])
      .map((n) => ({ id: n.id, path: n.path, version: String(n.version), ...(n.locked ? { locked: true } : {}), ...(n.app ? { app: true } : {}) }));
  }

  async read(id: string) {
    let meta: { path: string; version: number } | undefined;
    const text = await paged(async (from) => {
      const r = await this.mcp.call("fetch", { id, ...(from ? { lines: `${from}-` } : {}) });
      meta ??= r.metadata;
      const next = String(r.metadata?.next ?? "").match(/(\d+)-/);
      return { text: r.text, next: next ? Number(next[1]) : undefined };
    });
    return { text, version: String(meta!.version), path: meta!.path };
  }

  async create(path: string, text: string, inside?: string) {
    const r = await this.mcp.call("create", inside ? { content: text, inside } : { content: text, ...(dirOf(path) ? { path: dirOf(path) } : {}) });
    return r.id as string;
  }

  async update(id: string, base: string, text: string, version: string) {
    const edit = editFor(base, text);
    try {
      if (edit) await this.mcp.call("edit", { id, expected_version: Number(version), edits: [edit] });
      else await this.mcp.call("write", { id, content: text, expected_version: Number(version) });
    } catch (e) {
      if (changed(e)) throw new Changed(id);
      throw e;
    }
  }

  async move(id: string, _from: string, to: string) {
    await this.mcp.call("move", { id, to });
  }

  async remove(id: string) {
    await this.mcp.call("delete", { id });
  }
}

type Summary = { id: string; title: string; folder: string; updated: string; locked?: boolean; sub_note_of?: string };

class ClassicRemote implements Remote {
  readonly kind = "classic";
  constructor(private mcp: Mcp) {}

  async list() {
    const all: Summary[] = [];
    for (let offset: number | null = 0; offset !== null && all.length < 100_000;) {
      const r = await this.mcp.call("list_notes", { include_sub_notes: true, limit: 200, offset });
      all.push(...r.notes);
      offset = r.next_offset;
    }
    // The same paths the files tools give: folder and title; a sub-note under its parent's path.
    const byId = new Map(all.map((n) => [n.id, n]));
    const name = (t: string) => t.replace(/\//g, "∕").trim() || "Untitled";
    const pathOf = (n: Summary, depth = 0): string => {
      const parent = n.sub_note_of ? byId.get(n.sub_note_of) : undefined;
      if (parent && depth < 8) return `${pathOf(parent, depth + 1).replace(/\.md$/, "")}/${name(n.title)}.md`;
      return `${n.folder ? n.folder + "/" : ""}${name(n.title)}.md`;
    };
    return all.map((n) => ({ id: n.id, path: pathOf(n), version: n.updated, ...(n.locked ? { locked: true } : {}) }));
  }

  private async readFull(id: string) {
    let first: { version: number; updated: string; title: string; folder: string; parent: { id: string } | null } | undefined;
    const text = await paged(async (from) => {
      const r = await this.mcp.call("read_note", { id, ...(from ? { start_line: from } : {}) });
      first ??= r;
      return { text: r.markdown, next: r.truncated ? r.next_start_line : undefined };
    });
    return { text, ...first! };
  }

  async read(id: string) {
    const r = await this.readFull(id);
    // A sub-note's path goes through its parent's: the listing has it.
    const path = r.parent ? (await this.list()).find((n) => n.id === id)!.path : `${r.folder ? r.folder + "/" : ""}${r.title.replace(/\//g, "∕").trim() || "Untitled"}.md`;
    return { text: r.text, version: r.updated, path };
  }

  async create(path: string, text: string, inside?: string) {
    const r = inside
      ? await this.mcp.call("create_sub_note", { id: inside, body: text })
      : await this.mcp.call("create_note", { body: text, ...(dirOf(path) ? { folder: dirOf(path) } : {}) });
    return r.created.id as string;
  }

  async update(id: string, base: string, text: string, version: string) {
    // The list's version is the updated time; edit_note checks the version number.
    const now = await this.readFull(id);
    if (now.updated !== version) throw new Changed(id);
    const edit = editFor(base, text);
    try {
      if (edit) await this.mcp.call("edit_note", { id, expected_version: now.version, edits: [edit] });
      else await this.mcp.call("replace_note_body", { id, body: text, expected_version: now.version });
    } catch (e) {
      if (changed(e)) throw new Changed(id);
      throw e;
    }
  }

  async move(id: string, from: string, to: string) {
    if (dirOf(from) !== dirOf(to)) await this.mcp.call("move_note", { id, folder: dirOf(to) || "Notes" });
    if (stemOf(from) !== stemOf(to)) {
      const now = await this.readFull(id);
      await this.mcp.call("replace_note_body", { id, body: retitle(now.text, stemOf(to)), expected_version: now.version });
    }
  }

  async remove(id: string) {
    await this.mcp.call("delete_note", { id });
  }
}
