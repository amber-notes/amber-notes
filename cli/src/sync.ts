// One pass of the sync: compare the folder, the account and .amber/state.json (what both sides
// agreed on last time), then carry each side's changes to the other. Nothing is ever lost: when a
// note changed on both sides, the folder's text goes to "Title (conflict YYYY-MM-DD).md" (a new
// note, so every device sees both), and the account's text keeps the note's own file.
//
// pull only brings the account's changes down; it never changes the account.
import { Changed, type Remote, type RemoteNote } from "./remote.ts";
import { conflictPath, day, dirOf, isSyncable, localPathFor, retitle, stemOf, withTitle } from "./paths.ts";
import { type Entry, hashOf, loadState, saveState, type State } from "./state.ts";

export type Mode = "pull" | "sync";

export type Report = {
  down: string[]; up: string[]; created: string[]; moved: string[]; deleted: string[]; conflicts: string[];
  skipped: string[]; pending: string[];
};

export type Options = {
  dir: string; server: string; remote: Remote; mode: Mode;
  /** Go ahead even when most notes look deleted on one side (a folder that isn't mounted, another account). */
  force?: boolean;
  log?: (line: string) => void;
  now?: () => Date;
};

type Local = { text: string; hash: string };

/** Every syncable file in the folder, by its path relative to it. */
export async function scan(dir: string): Promise<Map<string, Local>> {
  const out = new Map<string, Local>();
  async function walk(rel: string) {
    for await (const e of Deno.readDir(rel ? `${dir}/${rel}` : dir)) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory && !/\.app$/i.test(e.name)) await walk(p);
      else if (e.isFile && isSyncable(p)) {
        const text = await Deno.readTextFile(`${dir}/${p}`);
        out.set(p, { text, hash: await hashOf(text) });
      }
    }
  }
  await walk("");
  return out;
}

/** Writes a file whole (a temporary file renamed over it), making its folders. */
async function put(dir: string, rel: string, text: string) {
  const full = `${dir}/${rel}`;
  await Deno.mkdir(dirOf(full), { recursive: true });
  const tmp = `${dir}/.amber/tmp-${crypto.randomUUID()}`;
  await Deno.mkdir(`${dir}/.amber`, { recursive: true });
  await Deno.writeTextFile(tmp, text);
  await Deno.rename(tmp, full);
}

/** Removes `rel`'s now-empty folders, up to the sync folder. */
async function prune(dir: string, rel: string) {
  for (let d = dirOf(rel); d; d = dirOf(d)) {
    try { await Deno.remove(`${dir}/${d}`); } catch { return; }
  }
}

async function rename(dir: string, from: string, to: string) {
  if (from === to) return;
  await Deno.mkdir(dirOf(`${dir}/${to}`), { recursive: true });
  await Deno.rename(`${dir}/${from}`, `${dir}/${to}`);
  await prune(dir, from);
}

/** A file the account deleted goes to .amber/trash, not away. */
async function trash(dir: string, rel: string, date: string) {
  const to = `.amber/trash/${date}/${rel}`;
  await Deno.mkdir(dirOf(`${dir}/${to}`), { recursive: true });
  await Deno.rename(`${dir}/${rel}`, `${dir}/${to}`);
  await prune(dir, rel);
}

export async function syncOnce(o: Options): Promise<Report> {
  const { dir, remote, mode } = o;
  const log = o.log ?? (() => {});
  const date = day(o.now?.() ?? new Date());
  const report: Report = { down: [], up: [], created: [], moved: [], deleted: [], conflicts: [], skipped: [], pending: [] };
  await Deno.mkdir(dir, { recursive: true });
  const state = await loadState(dir, o.server);
  const save = () => saveState(dir, state);

  const listed = await remote.list();
  const remoteById = new Map<string, RemoteNote>();
  for (const n of listed) {
    if (n.locked) { report.skipped.push(`${n.path} (locked: only the app can open it)`); continue; }
    remoteById.set(n.id, n);
  }
  const local = await scan(dir);

  // Guard: most notes gone from one side at once is a folder that isn't mounted or another
  // account, not a mass delete.
  const tracked = Object.keys(state.notes).length;
  if (tracked >= 10 && !o.force) {
    const goneRemote = Object.keys(state.notes).filter((id) => !remoteById.has(id) && !listed.some((n) => n.id === id)).length;
    const goneLocal = Object.values(state.notes).filter((e) => !local.has(e.path)).length;
    if (goneRemote > tracked / 2) throw new Error(`${goneRemote} of ${tracked} notes are gone from the account. Is this the right account? Nothing was changed; run again with --force if this is what you want.`);
    if (goneLocal > tracked / 2) throw new Error(`${goneLocal} of ${tracked} files are gone from ${dir}. Is the folder mounted? Nothing was changed; run again with --force if this is what you want.`);
  }

  const trackedPaths = () => new Set(Object.values(state.notes).map((e) => e.path.toLowerCase()));
  const used = (p: string) => local.has(p) || [...local.keys()].some((k) => k.toLowerCase() === p) || trackedPaths().has(p);
  /** The file for a note at `remotePath`: where it is, if its remote path didn't change; else a free path. */
  const placeFor = (id: string, remotePath: string, e?: Entry) =>
    e && e.remotePath === remotePath ? e.path : localPathFor(remotePath, id, (p) => used(p) && p !== e?.path.toLowerCase());
  const remember = async (id: string, path: string, remotePath: string, version: string, text: string) => {
    state.notes[id] = { path, remotePath, version, hash: await hashOf(text) };
    await save();
  };
  /** Writes the account's text to the note's file (moving the file if its path changed). */
  const bringDown = async (id: string, e: Entry | undefined, from: string | undefined) => {
    const r = await remote.read(id);
    const path = placeFor(id, r.path, e);
    if (from && from !== path && local.has(from)) {
      await rename(dir, from, path);
      local.set(path, local.get(from)!);
      local.delete(from);
    }
    if (local.get(path)?.text !== r.text) await put(dir, path, r.text);
    local.set(path, { text: r.text, hash: await hashOf(r.text) });
    await remember(id, path, r.path, r.version, r.text);
    return { path, text: r.text };
  };
  /** After a change went up: the account's text and path, written back if the server changed them
   *  (a new title, a note that landed in another folder). */
  const settle = async (id: string, path: string) => {
    const r = await remote.read(id);
    const sent = local.get(path)?.text;
    const e = state.notes[id];
    let at = path;
    if (!e || r.path !== e.remotePath) {
      const want = localPathFor(r.path, id, (p) => used(p) && p !== path.toLowerCase());
      if (want !== path) {
        await rename(dir, path, want);
        local.delete(path);
        at = want;
      }
    }
    if (r.text !== sent) {
      // Only the text just sent is replaced; a newer edit on disk stays and goes up next pass.
      const onDisk = await Deno.readTextFile(`${dir}/${at}`).catch(() => undefined);
      if (onDisk === undefined || onDisk === sent) await put(dir, at, r.text);
    }
    local.set(at, { text: r.text, hash: await hashOf(r.text) });
    await remember(id, at, r.path, r.version, r.text);
    return at;
  };

  // Files that moved here: a tracked file gone, an untracked one with its exact text.
  const untracked = () => [...local.keys()].filter((p) => !trackedPaths().has(p.toLowerCase()));
  const movedTo = new Map<string, string>();
  for (const [id, e] of Object.entries(state.notes)) {
    if (local.has(e.path)) continue;
    const to = untracked().find((p) => local.get(p)!.hash === e.hash && ![...movedTo.values()].includes(p));
    if (to) movedTo.set(id, to);
  }

  for (const [id, e] of Object.entries(state.notes)) {
    const r = remoteById.get(id);
    if (!r && listed.some((n) => n.id === id)) continue; // locked now: left as it is
    const at = movedTo.get(id) ?? e.path;
    const l = local.get(at);
    const localChanged = !l || l.hash !== e.hash;
    const remoteChanged = !r || r.version !== e.version || r.path !== e.remotePath;

    if (l && r) {
      if (!localChanged && !remoteChanged) {
        if (at !== e.path) {
          if (mode === "pull") { report.pending.push(`${e.path} → ${at} (moved here; pull doesn't send it)`); continue; }
          await remote.move(id, e.remotePath, at);
          state.notes[id] = { ...e, path: at };
          const now = await settle(id, at);
          report.moved.push(`${e.path} → ${now}`);
          log(`moved   ${e.path} → ${now}`);
        }
        continue;
      }
      if (localChanged && !remoteChanged && at === e.path) {
        if (mode === "pull") { report.pending.push(`${at} (changed here; pull doesn't send it)`); continue; }
        if (!l.text.trim()) { report.skipped.push(`${at} (empty: delete the file to delete the note)`); continue; }
        const base = await remote.read(id);
        if (await hashOf(base.text) === e.hash) {
          try {
            await remote.update(id, base.text, l.text, e.version);
            const now = await settle(id, at);
            report.up.push(now);
            log(`up      ${now}`);
            continue;
          } catch (err) {
            if (!(err instanceof Changed)) throw err;
          }
        }
        // It changed in the account meanwhile: a conflict, handled below with fresh versions.
      }
      if (!localChanged && remoteChanged) {
        if (at !== e.path && mode === "sync") {
          // Moved here, changed in the account: the move goes up, then the text comes down.
          await remote.move(id, r.path, at);
          state.notes[id] = { ...e, path: at };
          report.moved.push(`${e.path} → ${at}`);
        }
        const { path } = await bringDown(id, state.notes[id], at);
        report.down.push(path);
        log(`down    ${path}`);
        continue;
      }
      // Both changed (or moved here and changed in the account).
      const theirs = await remote.read(id);
      if (theirs.text === l.text) {
        await remember(id, at, r.path, r.version, l.text);
        continue;
      }
      const copy = conflictPath(at, date, (p) => used(p));
      await put(dir, copy, retitle(l.text, stemOf(copy)));
      local.set(copy, { text: retitle(l.text, stemOf(copy)), hash: await hashOf(retitle(l.text, stemOf(copy))) });
      const { path } = await bringDown(id, { ...e, path: at }, at);
      report.conflicts.push(`${path}: this folder's text kept as ${copy}`);
      log(`conflict ${path}: this folder's text kept as ${copy}`);
      continue;
    }

    if (!l && r) {
      if (mode === "sync" && !remoteChanged) {
        await remote.remove(id);
        remoteById.delete(id);
        delete state.notes[id];
        await save();
        report.deleted.push(`${e.path} (in Amber: to Recently Deleted)`);
        log(`deleted ${e.path} (in Amber: Recently Deleted keeps it 30 days)`);
        continue;
      }
      // Deleted here but changed in the account (or pull): the account's text comes back.
      const { path } = await bringDown(id, { ...e, path: at }, undefined);
      report.down.push(path);
      log(`down    ${path}${mode === "sync" ? " (deleted here, changed in Amber: kept)" : ""}`);
      continue;
    }

    if (l && !r) {
      delete state.notes[id];
      await save();
      if (!localChanged) {
        await trash(dir, at, date);
        local.delete(at);
        report.deleted.push(`${at} (here: moved to .amber/trash/${date}/)`);
        log(`deleted ${at} (deleted in Amber; kept in .amber/trash/${date}/)`);
      } else {
        // Deleted in the account but changed here: the file stays and goes up as a new note.
        report.conflicts.push(`${at}: deleted in Amber, changed here; kept${mode === "sync" ? " and sent as a new note" : ""}`);
        log(`conflict ${at}: deleted in Amber, changed here; kept`);
      }
      continue;
    }
    delete state.notes[id];
    await save();
  }

  // Notes new to this folder.
  for (const [id, r] of remoteById) {
    if (state.notes[id]) continue;
    const path = localPathFor(r.path, id, (p) => trackedPaths().has(p));
    const mine = local.get(path);
    const theirs = await remote.read(id);
    if (mine && mine.text !== theirs.text) {
      const copy = conflictPath(path, date, (p) => used(p));
      const kept = retitle(mine.text, stemOf(copy));
      await put(dir, copy, kept);
      local.set(copy, { text: kept, hash: await hashOf(kept) });
      report.conflicts.push(`${path}: this folder's file kept as ${copy}`);
      log(`conflict ${path}: this folder's file kept as ${copy}`);
    }
    if (mine?.text !== theirs.text) await put(dir, path, theirs.text);
    local.set(path, { text: theirs.text, hash: await hashOf(theirs.text) });
    await remember(id, path, r.path, r.version, theirs.text);
    if (!mine || mine.text !== theirs.text) { report.down.push(path); log(`down    ${path}`); }
  }

  // Files new to the account.
  for (const path of untracked()) {
    if (mode === "pull") { report.pending.push(`${path} (new here; pull doesn't send it)`); continue; }
    const l = local.get(path)!;
    const text = withTitle(stemOf(path), l.text);
    if (text !== l.text) { await put(dir, path, text); local.set(path, { text, hash: await hashOf(text) }); }
    const parent = Object.entries(state.notes).find(([, e]) => dirOf(path) && e.path.toLowerCase() === `${dirOf(path)}.md`.toLowerCase())?.[0];
    const id = await remote.create(path, text, parent);
    state.notes[id] = { path, remotePath: "", version: "", hash: await hashOf(text) };
    const now = await settle(id, path);
    report.created.push(now);
    log(`created ${now}`);
  }

  state.synced = (o.now?.() ?? new Date()).toISOString();
  await save();
  return report;
}

/** What would happen, without changing anything: for `amber status`. */
export async function pendingHere(dir: string, state: State): Promise<{ changed: string[]; added: string[]; removed: string[]; conflicts: string[] }> {
  const local = await scan(dir);
  const tracked = new Set(Object.values(state.notes).map((e) => e.path));
  const changed: string[] = [], removed: string[] = [];
  for (const e of Object.values(state.notes)) {
    const l = local.get(e.path);
    if (!l) removed.push(e.path);
    else if (l.hash !== e.hash) changed.push(e.path);
  }
  const added = [...local.keys()].filter((p) => !tracked.has(p));
  const conflicts = [...local.keys()].filter((p) => /\(conflict \d{4}-\d{2}-\d{2}( \d+)?\)\.md$/.test(p));
  return { changed, added, removed, conflicts };
}
