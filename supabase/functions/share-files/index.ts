// Files for a shared note's page: short-lived signed URLs for the images and files the
// shared note (or one of its included sub-notes) links to, and nothing else.
//
//   GET /functions/v1/share-files?slug=<slug>[&sub=<sub-note id>]
//   → { files: { "<attachment id>": { path, name, type, size } } }
//
// `path` is signed and relative to the Supabase URL (/storage/v1/object/sign/…?token=…): the
// caller prefixes its own public Supabase URL, so this works behind any internal hostname.
//
// Public on purpose (the share page has no account); the slug is the secret. The bucket stays
// private: each URL is signed for one object and expires, and an id the note doesn't link to
// gets no URL.

import postgres from "npm:postgres@3.4.5";
import { referencedFiles, RateLimiter } from "./logic.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 2, idle_timeout: 20, prepare: false });
const API = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TTL = 60 * 60; // the page caches for a minute; an hour leaves plenty of room
const perIP = new RateLimiter(120, 60_000);

const headers = { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...headers, "access-control-allow-methods": "GET, OPTIONS" } });
  if (req.method !== "GET") return reply({ error: "method not allowed" }, 405);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (!perIP.allow(ip)) return reply({ error: "slow down" }, 429);

  const url = new URL(req.url);
  const slug = url.searchParams.get("slug") ?? "";
  const sub = url.searchParams.get("sub");
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(slug) || (sub !== null && !/^[0-9a-f-]{36}$/i.test(sub))) return reply({ error: "not found" }, 404);

  try {
    const [row] = await sql<{ page: { body: string } | null; owner: string | null }[]>`
      select public.shared_note(${slug}, ${sub}::uuid) as page,
             (select user_id from public.note_shares where slug = ${slug} and revoked_at is null) as owner`;
    if (!row?.page || !row.owner) return reply({ error: "not found" }, 404);
    const ids = referencedFiles(row.page.body);
    if (ids.length === 0) return reply({ files: {} });
    const rows = await sql<{ id: string; filename: string; content_type: string; size: string; storage_path: string }[]>`
      select id, filename, content_type, size, storage_path from public.attachments
      where id = any(${ids}::uuid[]) and user_id = ${row.owner} and deleted_at is null`;
    const files: Record<string, { path: string; name: string; type: string; size: number }> = {};
    await Promise.all(rows.map(async (a) => {
      const res = await fetch(`${API}/storage/v1/object/sign/files/${a.storage_path.split("/").map(encodeURIComponent).join("/")}`, {
        method: "POST",
        headers: { authorization: `Bearer ${SERVICE}`, apikey: SERVICE, "content-type": "application/json" },
        body: JSON.stringify({ expiresIn: TTL }),
      });
      if (!res.ok) { await res.body?.cancel(); return; }
      const { signedURL } = await res.json() as { signedURL: string };
      files[a.id] = { path: `/storage/v1${signedURL}`, name: a.filename, type: a.content_type, size: Number(a.size) };
    }));
    return reply({ files });
  } catch (e) {
    console.error("share-files", (e as Error).message);
    return reply({ error: "unavailable" }, 500);
  }
});
