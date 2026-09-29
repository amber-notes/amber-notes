// Account deletion end to end against the LOCAL stack: scripts/account-e2e.sh
// Makes two throwaway users; deletes one; the other is untouched.
import { assert, assertEquals } from "jsr:@std/assert@1";
import postgres from "npm:postgres@3.4.5";

const API = Deno.env.get("PANE_API")!, ANON = Deno.env.get("PANE_ANON")!, SERVICE = Deno.env.get("PANE_SERVICE")!;

const db = postgres(Deno.env.get("PANE_DB")!, { max: 1, prepare: false });

// Throwaway users made straight in the database (email sign-ups are off, like production).
async function newUser() {
  const id = crypto.randomUUID(), email = `delete-test-${id}@example.com`, password = crypto.randomUUID();
  await db`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', ${id}, 'authenticated', 'authenticated', ${email}, extensions.crypt(${password}, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')`;
  await db`insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), ${id}, ${id}, ${db.json({ sub: id, email })}, 'email', now(), now(), now())`;
  const s = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email, password }),
  });
  const jwt = (await s.json()).access_token as string;
  assert(jwt, "signed in");
  return { id, jwt };
}

async function rest(path: string, jwt: string, init: RequestInit = {}) {
  const r = await fetch(`${API}/rest/v1/${path}`, { ...init, headers: { apikey: ANON, authorization: `Bearer ${jwt}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers ?? {}) } });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
}

async function seed(u: { id: string; jwt: string }) {
  const note = crypto.randomUUID(), file = crypto.randomUUID();
  assertEquals((await rest("notes", u.jwt, { method: "POST", body: JSON.stringify({ id: note, body: "Keep me\n\nhello" }) })).status, 201);
  const up = await fetch(`${API}/storage/v1/object/files/${u.id}/${file}/a.txt`, {
    method: "POST", headers: { apikey: ANON, authorization: `Bearer ${u.jwt}`, "content-type": "text/plain" }, body: "file body",
  });
  assertEquals(up.status, 200, await up.clone().text());
  const photo = `${crypto.randomUUID().replaceAll("-", "")}.jpg`;
  const pic = await fetch(`${API}/storage/v1/object/avatars/${photo}`, {
    method: "POST", headers: { apikey: ANON, authorization: `Bearer ${u.jwt}`, "content-type": "image/jpeg" }, body: new Uint8Array([255, 216, 255]),
  });
  assertEquals(pic.status, 200, await pic.clone().text());
  return { note, file, photo };
}

const del = (jwt: string | null) => fetch(`${API}/functions/v1/account`, { method: "DELETE", headers: jwt ? { authorization: `Bearer ${jwt}`, apikey: ANON } : { apikey: ANON } });
const objects = async (uid: string) => {
  const r = await fetch(`${API}/storage/v1/object/list/files`, { method: "POST", headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" }, body: JSON.stringify({ prefix: `${uid}/`, limit: 100 }) });
  return (await r.json()) as unknown[];
};

Deno.test("deleting an account removes its notes, files and login, and nothing of anyone else's", async () => {
  const a = await newUser(), b = await newUser();
  const as = await seed(a);
  const bs = await seed(b);

  const wrong = await del(null);
  assert(wrong.status === 401, `no token → ${wrong.status}`);
  await wrong.body?.cancel();
  const get = await fetch(`${API}/functions/v1/account`, { headers: { authorization: `Bearer ${a.jwt}`, apikey: ANON } });
  assertEquals(get.status, 405);
  await get.body?.cancel();

  const r = await del(a.jwt);
  const body = await r.json();
  assertEquals(r.status, 200, JSON.stringify(body));
  assertEquals(body.deleted, true);
  assertEquals(body.files, 2, "the attachment and the profile photo");

  // A's login, rows and files are gone.
  assertEquals((await db`select 1 from auth.users where id = ${a.id}`).length, 0);
  const rows = await fetch(`${API}/rest/v1/notes?user_id=eq.${a.id}&select=id`, { headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` } });
  assertEquals((await rows.json()).length, 0);
  assertEquals((await objects(a.id)).length, 0);
  assertEquals((await fetch(`${API}/storage/v1/object/public/avatars/${as.photo}`)).status >= 400, true, "A's photo is gone");

  // B is untouched.
  assertEquals((await rest(`notes?id=eq.${bs.note}&select=id`, b.jwt)).body.length, 1);
  assertEquals((await objects(b.id)).length, 1);
  const bp = await fetch(`${API}/storage/v1/object/public/avatars/${bs.photo}`);
  assertEquals(bp.status, 200, "B's photo stays");
  await bp.body?.cancel();

  // The old token can't delete anything again.
  const again = await del(a.jwt);
  assert(again.status === 401, `deleted user's token → ${again.status}`);
  await again.body?.cancel();

  await del(b.jwt).then((x) => x.body?.cancel());
  await db.end();
});
