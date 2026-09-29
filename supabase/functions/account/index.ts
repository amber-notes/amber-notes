// Deletes the signed-in person's account and everything in it, as the App Store requires.
//
//   DELETE /functions/v1/account     Authorization: Bearer <the user's access token>
//   → 200 { deleted: true, files: <n> }
//
// Files in the `files` bucket are removed first (storage objects don't cascade), then the auth
// user; every public table (notes, folders, revisions, attachments, tokens, OAuth grants, share
// links, limits) cascades from auth.users. The caller is whoever the access token says: there is
// no way to name another account.

import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 1, idle_timeout: 20, prepare: false });
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

Deno.serve(async (req) => {
  if (req.method !== "DELETE") return json({ error: "Use DELETE." }, 405);
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const uid = token ? await userFor(token) : null;
  if (!uid) return json({ error: "Sign in again, then try deleting your account." }, 401);
  try {
    const files = await removeFiles(uid);
    // Straight in the database: it doesn't depend on which key format the auth admin API accepts.
    // Identities, sessions and every public table cascade from auth.users.
    await sql`delete from auth.users where id = ${uid}`;
    return json({ deleted: true, files });
  } catch (e) {
    console.error("account delete", uid, (e as Error).message);
    return json({ error: "Couldn't delete the account. Nothing more was removed; try again." }, 500);
  }
});
