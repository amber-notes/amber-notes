// For tests only (nothing the server imports): an account set up as the app does it (a data key
// and its account_keys row), and notes, folders and files sealed with it as the app writes them,
// on the PGlite database from pglite.ts.
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { aesKey, type Bytes, keyIdOf, newDataKey, recoveryKEK, sealFile, shareTag, toBase64, Vault, verifierOf, wrap } from "../_shared/e2ee.ts";
import { previewOf, titleOf } from "./notes.ts";
import { asUser, newUser, sqlFor } from "./pglite.ts";
import type { ToolContext } from "./tools.ts";

/** What the app sends with every write: its device, and that it knows locked notes and encryption. */
export const APP = { "request.headers": JSON.stringify({ "x-pane-device": "Mac", "x-amber-client": "lock-aware/1 e2ee/1" }) };

// deno-lint-ignore no-explicit-any
export const app = (pg: PGlite, me: string, sql: string, params: unknown[] = []) => asUser<any>(pg, me, sql, params, APP);

export type Account = { id: string; dk: Bytes; keyId: string; vault: Vault };

/** A vault for a copy of the key (Vault.from wipes what it's given). */
export const vaultOf = (dk: Bytes, userId: string) => Vault.from(dk.slice(), userId);

/** A user whose first device has made the account's key. */
export async function account(pg: PGlite, id?: string): Promise<Account> {
  const me = id ?? await newUser(pg);
  const dk = newDataKey();
  const keyId = await keyIdOf(dk);
  const recovery = await wrap(dk, await recoveryKEK(crypto.getRandomValues(new Uint8Array(16)), me), "recovery", me);
  await app(pg, me, `select * from public.create_account_key($1, $2, $3, 0)`, [keyId, await verifierOf(dk, me), recovery]);
  return { id: me, dk, keyId, vault: await vaultOf(dk, me) };
}

/** A ToolContext with its own vault, as index.ts makes one per request. */
export async function toolContext(pg: PGlite, a: Account, canWrite = true, client = "Claude"): Promise<ToolContext> {
  return { sql: sqlFor(pg), userId: a.id, client, canWrite, vault: await vaultOf(a.dk, a.id) };
}

type NoteOptions = { id?: string; folder?: string | null; parent?: string | null; pinned?: boolean };

export async function note(pg: PGlite, a: Account, body: string, o: NoteOptions = {}): Promise<string> {
  const id = o.id ?? crypto.randomUUID();
  await app(pg, a.id, `insert into public.notes (id, body_ct, head_ct, folder_id, parent_id, is_pinned) values ($1, $2, $3, $4, $5, $6)`,
    [id, await a.vault.sealBody(id, body), await a.vault.sealHead(id, { title: titleOf(body), preview: previewOf(body) }),
      o.folder ?? null, o.parent ?? null, o.pinned ?? false]);
  return id;
}

/** The app saving new text (makes a version, like an edit on a device). */
export async function edit(pg: PGlite, a: Account, id: string, body: string, settings: Record<string, string> = APP) {
  await asUser(pg, a.id, `update public.notes set body_ct = $2, head_ct = $3, updated_at = now() where id = $1`,
    [id, await a.vault.sealBody(id, body), await a.vault.sealHead(id, { title: titleOf(body), preview: previewOf(body) })], settings);
}

/** What a note holds, opened: its head and body (null when locked). */
export async function opened(pg: PGlite, a: Account, id: string) {
  const [n] = (await pg.query<{ head_ct: string; body_ct: string | null }>(`select head_ct, body_ct from public.notes where id = $1`, [id])).rows;
  return { head: await a.vault.openHead(id, n.head_ct), body: n.body_ct ? await a.vault.openBody(id, n.body_ct) : null };
}

/** What a device publishes for a shared page: {title, body, pages: [{id, parent_id, title, body}], files}. */
export type ShareCopy = { title: string; body: string; pages?: { id: string; parent_id: string | null; title: string; body: string }[]; files?: string[] };

/** Shares a note as the app does: picks the slug, tags the share with the account's key, publishes
 *  the copy. Returns {slug, missing_files}. */
export async function share(pg: PGlite, a: Account, noteId: string, copy: ShareCopy, includeSubnotes = false): Promise<{ slug: string; missing_files: string[] }> {
  const [{ slug }] = await app(pg, a.id, `select public.share_slug($1) as slug`, [noteId]);
  const tag = await shareTag(a.dk.slice(), noteId, slug, includeSubnotes);
  const [{ r }] = await app(pg, a.id, `select public.share_note($1, $2, $3, $4, $5) as r`,
    [noteId, slug, includeSubnotes, tag, JSON.stringify({ pages: [], files: [], ...copy })]);
  return r;
}

/** A notes password, as the app sets it up; returns its key id (locked notes' boxes name it). */
export async function notesPassword(pg: PGlite, a: Account): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const lockKey = [...new Uint8Array(await crypto.subtle.digest("SHA-256", salt))].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
  await app(pg, a.id, `insert into public.note_locks (salt, iterations, key_id, verifier) values ($1, 600000, $2, 'v')`, [toBase64(salt), lockKey]);
  return lockKey;
}

/** A locked note: its head is its title only, its text a box under the notes password. */
export async function lockedNote(pg: PGlite, a: Account, lockKey: string, title: string, o: NoteOptions = {}): Promise<string> {
  const id = o.id ?? crypto.randomUUID();
  const box = `amb2.${lockKey}.${toBase64(crypto.getRandomValues(new Uint8Array(64)))}`;
  await app(pg, a.id, `insert into public.notes (id, head_ct, body_ct, locked_body, folder_id, parent_id) values ($1, $2, null, $3, $4, $5)`,
    [id, await a.vault.sealHead(id, { title }), box, o.folder ?? null, o.parent ?? null]);
  return id;
}

export async function folder(pg: PGlite, a: Account, name: string, parent: string | null = null): Promise<string> {
  const id = crypto.randomUUID();
  await app(pg, a.id, `insert into public.folders (id, name_ct, parent_id, sort_index) values ($1, $2, $3, $4)`,
    [id, await a.vault.sealFolder(id, name), parent, Date.now() / 1000]);
  return id;
}

/** A file's row, and its bytes sealed as the app uploads them to Storage. With `folder`, a file
 *  that sits in that folder on its own. */
export async function file(pg: PGlite, a: Account, name: string, type: string, content: Uint8Array, o: { folder?: string | null } = {}) {
  const id = crypto.randomUUID();
  const path = `${a.id}/${id}`;
  await app(pg, a.id, `insert into public.attachments (id, meta_ct, size, storage_path, folder_id) values ($1, $2, $3, $4, $5)`,
    [id, await a.vault.sealFileMeta(id, { name, type, size: content.length }), content.length, path, o.folder ?? null]);
  const sealed = await sealFile(new Uint8Array(content), await aesKey(a.dk.slice()), a.keyId, id);
  return { id, path, sealed };
}

/** Answers Storage downloads (GET /storage/v1/object/files/<path>) from `objects`; everything else
 *  goes to `next`. Returns a function that puts the previous fetch back. */
export function stubStorage(base: string, objects: Map<string, Uint8Array>, next = globalThis.fetch): () => void {
  const previous = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const root = `${base}/storage/v1/object/`;
    const prefix = `${root}files/`;
    if (url.startsWith(root)) {
      const auth = new Headers(init?.headers).get("authorization");
      if (auth !== `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`) return new Response("unauthorized", { status: 401 });
      const method = init?.method ?? "GET";
      // Copy (a file's version), remove (old versions), upload (new bytes), download.
      if (url === `${root}copy`) {
        const { sourceKey, destinationKey } = JSON.parse(String(init?.body));
        const src = objects.get(sourceKey);
        if (!src) return new Response("not found", { status: 404 });
        objects.set(destinationKey, src);
        return new Response("{}");
      }
      if (url === `${root}files` && method === "DELETE") {
        for (const p of JSON.parse(String(init?.body)).prefixes) objects.delete(p);
        return new Response("[]");
      }
      if (url.startsWith(prefix)) {
        const key = decodeURIComponent(url.slice(prefix.length));
        if (method === "POST" || method === "PUT") {
          objects.set(key, new Uint8Array(init?.body as Uint8Array));
          return new Response("{}");
        }
        const bytes = objects.get(key);
        return bytes ? new Response(new Uint8Array(bytes)) : new Response("not found", { status: 404 });
      }
    }
    return await next(input, init);
  };
  return () => { globalThis.fetch = previous; };
}
