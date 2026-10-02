// Files for a shared page: the readable copies the owner's device published with the page
// (note_share_files), and only those the page's copy embeds. Notes and the files bucket are sealed
// with the account's key, so this function never reads them.
//
//   GET /functions/v1/share-files?slug=<slug>[&sub=<sub-note id>]
//   → { files: { "<attachment id>": { path, name, type, size } } }
//   GET /functions/v1/share-files?slug=<slug>&file=<attachment id>[&sub=<sub-note id>]
//   → the file's bytes
//
// `path` is relative to the Supabase URL (/functions/v1/share-files?slug=…&file=…): the caller
// prefixes its own public Supabase URL, so this works behind any internal hostname.
//
// Public on purpose (the share page has no account); the slug is the secret. The bytes come from
// shared_file(), which answers only for a file the (sub)page's published copy embeds and only while
// the link is live. Logs carry an event name and a status, never a slug or a file name.

import { clientAddress } from "../_shared/client.ts";
import { connect, readiness } from "../_shared/db.ts";
import { atHome } from "../_shared/region.ts";
import { dailyHash, hashSecret } from "../_shared/hash.ts";
import { log } from "../_shared/log.ts";
import { contentDisposition, filePath, RateLimiter, referencedFiles, servedType, SLUG, UUID } from "./logic.ts";

// Through the transaction pooler when DB_POOLER_HOST is set (_shared/db.ts says why).
const sql = connect(Deno.env, 2);
const ready = readiness(sql);
const perIP = new RateLimiter(120, 60_000);

const headers = { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

Deno.serve(atHome("share-files", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...headers, "access-control-allow-methods": "GET, OPTIONS" } });
  if (req.method !== "GET") return reply({ error: "method not allowed" }, 405);
  await ready();
  const ip = clientAddress(req);
  if (!perIP.allow(await dailyHash(hashSecret(), ip))) return reply({ error: "slow down" }, 429);

  const url = new URL(req.url);
  const slug = url.searchParams.get("slug") ?? "";
  const sub = url.searchParams.get("sub");
  const file = url.searchParams.get("file");
  if (!SLUG.test(slug) || (sub !== null && !UUID.test(sub)) || (file !== null && !UUID.test(file))) return reply({ error: "not found" }, 404);

  try {
    return file === null ? await list(slug, sub) : await bytes(slug, sub, file);
  } catch {
    log(file === null ? "share_files_list" : "share_files_get", { status: 500 });
    return reply({ error: "unavailable" }, 500);
  }
}));

/** The files the page embeds, with the address each one is served at. */
async function list(slug: string, sub: string | null): Promise<Response> {
  const [row] = await sql<{ page: { body: string } | null }[]>`select public.shared_note(${slug}, ${sub}::uuid) as page`;
  if (!row?.page) return reply({ error: "not found" }, 404);
  const ids = referencedFiles(row.page.body);
  if (ids.length === 0) return reply({ files: {} });
  const rows = await sql<{ attachment_id: string; filename: string; content_type: string; size: string }[]>`
    select attachment_id, filename, content_type, size from public.note_share_files
    where slug = ${slug} and attachment_id = any(${ids}::uuid[])`;
  const files: Record<string, { path: string; name: string; type: string; size: number }> = {};
  for (const f of rows) {
    files[f.attachment_id] = { path: filePath(slug, f.attachment_id, sub), name: f.filename, type: f.content_type, size: Number(f.size) };
  }
  return reply({ files });
}

/** One file's bytes, when the page embeds it. */
async function bytes(slug: string, sub: string | null, file: string): Promise<Response> {
  const [f] = await sql<{ filename: string; content_type: string; content: Uint8Array }[]>`
    select filename, content_type, content from public.shared_file(${slug}, ${sub}::uuid, ${file.toLowerCase()}::uuid)`;
  if (!f) return reply({ error: "not found" }, 404);
  const { type, inline } = servedType(f.content_type, f.filename);
  const body = new Uint8Array(f.content);
  return new Response(body, {
    headers: {
      "content-type": type,
      "content-length": String(body.byteLength),
      "content-disposition": contentDisposition(f.filename, inline),
      "x-content-type-options": "nosniff",
      // Short: Stop Sharing takes the file down within a minute.
      "cache-control": "private, max-age=60",
      "access-control-allow-origin": "*",
      "cross-origin-resource-policy": "cross-origin",
    },
  });
}
