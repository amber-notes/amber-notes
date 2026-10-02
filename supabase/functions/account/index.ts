// The signed-in person's account: delete it (as the App Store requires) or export it (GDPR).
//
//   DELETE /functions/v1/account         Authorization: Bearer <the user's access token>
//   → 200 { deleted: true, files: <n> }
//   → 403 { error, hint: "paused_after_reset", until } for 72 hours after a password reset (pause.ts)
//   GET    /functions/v1/account/export  Authorization: Bearer <the user's access token>
//   → 200 application/zip, "amber-notes-export-YYYY-MM-DD.zip" (see export.ts)
//
// Deleting: files in the `files` and `avatars` buckets are removed first (storage objects don't
// cascade), then what forget.ts lists, then the auth user; every public table (notes, folders,
// revisions, attachments, tokens, OAuth grants, share links, locks, usage counts, limits) cascades
// from auth.users. The caller is whoever the access token says: there is no way to name another
// account.

import { connect, readiness } from "../_shared/db.ts";
import { atHome } from "../_shared/region.ts";
import { logError } from "../_shared/log.ts";
import { collect, zip } from "./export.ts";
import { forget } from "./forget.ts";
import { DELETE_PAUSED, deletePausedUntil } from "./pause.ts";

// Through the transaction pooler when DB_POOLER_HOST is set (_shared/db.ts says why).
const sql = connect(Deno.env, 1);
const ready = readiness(sql);
const API = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The user the access token belongs to, checked by the auth server (not just decoded). */
export async function userFor(token: string): Promise<string | null> {
  const r = await fetch(`${API}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: ANON } });
  if (!r.ok) return null;
  const u = await r.json();
  return typeof u?.id === "string" ? u.id : null;
}

async function removeFiles(uid: string): Promise<number> {
  // Attachments sit under the account's folder; profile photos have random names and are
  // found by their owner.
  const files = await sql<{ name: string }[]>`
    select name from storage.objects where bucket_id = 'files' and (storage.foldername(name))[1] = ${uid}`;
  const photos = await sql<{ name: string }[]>`
    select name from storage.objects where bucket_id = 'avatars' and owner_id = ${uid}`;
  for (const [bucket, rows] of [["files", files], ["avatars", photos]] as const) {
    const names = rows.map((r) => r.name);
    for (let i = 0; i < names.length; i += 100) {
      const r = await fetch(`${API}/storage/v1/object/${bucket}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: names.slice(i, i + 100) }),
      });
      if (!r.ok) throw new Error(`storage delete failed: ${r.status}`);
    }
  }
  return files.length + photos.length;
}

// One export a minute per account (per isolate): it reads everything, so it isn't free.
const lastExport = new Map<string, number>();

Deno.serve(atHome("account", async (req) => {
  const exporting = req.method === "GET" && new URL(req.url).pathname.endsWith("/export");
  if (req.method !== "DELETE" && !exporting) return json({ error: "Use DELETE, or GET /account/export." }, 405);
  await ready();
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const uid = token ? await userFor(token) : null;
  if (!uid) return json({ error: exporting ? "Sign in again, then try exporting your data." : "Sign in again, then try deleting your account." }, 401);
  if (exporting) {
    const now = Date.now();
    if (now - (lastExport.get(uid) ?? 0) < 60_000) return json({ error: "You exported your data a moment ago. Try again in a minute." }, 429);
    lastExport.set(uid, now);
    try {
      const e = await collect(sql, uid);
      return new Response(zip(e), {
        headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${e.name}"`, "Cache-Control": "no-store" },
      });
    } catch (e) {
      lastExport.delete(uid);
      logError("account export", e);
      return json({ error: "Couldn't prepare your export. Try again." }, 500);
    }
  }
  const until = await deletePausedUntil(sql, uid);
  if (until) return json({ error: DELETE_PAUSED, hint: "paused_after_reset", until }, 403);
  try {
    const files = await removeFiles(uid);
    await forget(sql, uid);
    return json({ deleted: true, files });
  } catch (e) {
    logError("account delete", e);
    return json({ error: "Couldn't delete the account. Nothing more was removed; try again." }, 500);
  }
}));
