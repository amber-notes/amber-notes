// Share links end to end against the LOCAL stack: scripts/share-e2e.sh
import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { referencedFiles, RateLimiter } from "./logic.ts";

const API = Deno.env.get("PANE_API")!, ANON = Deno.env.get("PANE_ANON")!;
const A = Deno.env.get("PANE_USER_JWT")!, B = Deno.env.get("PANE_OTHER_JWT")!;
const uid = (jwt: string) => JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub as string;

async function rest(path: string, jwt: string | null, init: RequestInit = {}) {
  const res = await fetch(`${API}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: ANON, authorization: `Bearer ${jwt ?? ANON}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const rpc = (fn: string, args: unknown, jwt: string | null) => rest(`rpc/${fn}`, jwt, { method: "POST", body: JSON.stringify(args) });
async function note(jwt: string, body: string, extra: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  const r = await rest("notes", jwt, { method: "POST", body: JSON.stringify({ id, body, ...extra }) });
  assertEquals(r.status, 201, JSON.stringify(r.body));
  return id;
}
async function files(slug: string, sub?: string) {
  const res = await fetch(`${API}/functions/v1/share-files?slug=${slug}${sub ? `&sub=${sub}` : ""}`);
  return { status: res.status, body: await res.json() };
}

Deno.test("logic: referenced files and rate limit", () => {
  const id = "3f1c2b9a-1b7e-4c3a-9f0e-2a4b8c1d7e55";
  assertEquals(referencedFiles(`x\n![a.png](pane-file:${id.toUpperCase()})\n[b](pane-file:${id})\n[c](https://x)`), [id]);
  const rl = new RateLimiter(2, 1000);
  assert(rl.allow("ip", 0) && rl.allow("ip", 1));
  assert(!rl.allow("ip", 2));
  assert(rl.allow("ip", 1001));
});

Deno.test("a shared note, its sub-notes and its files", async () => {
  // A picture the note links to, and one it doesn't.
  const shown = crypto.randomUUID(), hidden = crypto.randomUUID();
  for (const [id, name] of [[shown, "shown.png"], [hidden, "hidden.png"]]) {
    const path = `${uid(A)}/${id}/${name}`;
    const up = await fetch(`${API}/storage/v1/object/files/${path}`, {
      method: "POST", headers: { apikey: ANON, authorization: `Bearer ${A}`, "content-type": "image/png" }, body: new Uint8Array([137, 80, 78, 71]),
    });
    assert(up.ok, await up.text());
    const r = await rest("attachments", A, { method: "POST", body: JSON.stringify({ id, filename: name, content_type: "public.png", size: 4, storage_path: path }) });
    assertEquals(r.status, 201, JSON.stringify(r.body));
  }
  const root = await note(A, `Trip plan\n\nDay one.\n\n![shown.png](pane-file:${shown})`);
  const child = await note(A, "Hotel\n\nRoom 12", { parent_id: root });
  const grandchild = await note(A, "Receipt\n\nPaid", { parent_id: child });
  const unrelated = await note(A, "Private\n\nnot shared");
  const theirs = await note(B, "B's note\n\nsecret");

  // Anyone else can't share your note; strangers can't list shares.
  assertNotEquals((await rpc("share_note", { p_note: root }, B)).status, 200);
  assertNotEquals((await rpc("share_note", { p_note: root }, null)).status, 200);

  const s1 = await rpc("share_note", { p_note: root }, A);
  assertEquals(s1.status, 200);
  const slug = s1.body as string;
  assert(/^[A-Za-z0-9_-]{24}$/.test(slug), slug);
  assertEquals((await rpc("share_note", { p_note: root, p_include_subnotes: false }, A)).body, slug, "reuses the live link");
  assertEquals((await rest(`note_shares?slug=eq.${slug}`, null)).body?.length ?? 0, 0, "anon sees no shares");
  assertEquals((await rest(`note_shares?slug=eq.${slug}`, B)).body.length, 0, "other users see no shares");

  const page = (await rpc("shared_note", { p_slug: slug }, null)).body;
  assertEquals(page.title, "Trip plan");
  assert(page.body.includes("Day one."));
  assertEquals(page.subnotes, []);
  assertEquals(Object.keys(page).sort(), ["body", "include_subnotes", "is_sub", "root_title", "shared_by", "subnotes", "title", "updated_at"]);
  assertEquals((await rpc("shared_note", { p_slug: slug, p_sub: child }, null)).body, null, "sub-notes need the option");

  // Files: only what the note links to.
  const f = await files(slug);
  assertEquals(f.status, 200);
  assertEquals(Object.keys(f.body.files), [shown]);
  const img = await fetch(API + f.body.files[shown].path);
  assertEquals(img.status, 200);
  await img.body?.cancel();

  // With sub-notes: children and deeper, never unrelated notes or someone else's.
  assertEquals((await rpc("share_note", { p_note: root, p_include_subnotes: true }, A)).body, slug);
  const withSubs = (await rpc("shared_note", { p_slug: slug }, null)).body;
  assertEquals(withSubs.subnotes.map((s: { title: string }) => s.title), ["Hotel"]);
  assertEquals((await rpc("shared_note", { p_slug: slug, p_sub: child }, null)).body.title, "Hotel");
  assertEquals((await rpc("shared_note", { p_slug: slug, p_sub: grandchild }, null)).body.title, "Receipt");
  assertEquals((await rpc("shared_note", { p_slug: slug, p_sub: unrelated }, null)).body, null);
  assertEquals((await rpc("shared_note", { p_slug: slug, p_sub: theirs }, null)).body, null);
  assertEquals((await files(slug, unrelated)).status, 404);

  // Trashing the note hides every page of the link; restoring brings it back.
  await rest(`notes?id=eq.${root}`, A, { method: "PATCH", body: JSON.stringify({ trashed_at: new Date().toISOString() }) });
  assertEquals((await rpc("shared_note", { p_slug: slug }, null)).body, null);
  assertEquals((await rpc("shared_note", { p_slug: slug, p_sub: child }, null)).body, null);
  assertEquals((await files(slug)).status, 404);
  assertNotEquals((await rpc("share_note", { p_note: root }, A)).status, 200, "a trashed note can't be shared");
  await rest(`notes?id=eq.${root}`, A, { method: "PATCH", body: JSON.stringify({ trashed_at: null }) });
  assertEquals((await rpc("shared_note", { p_slug: slug }, null)).body.title, "Trip plan");

  // Stopping kills the link for good; sharing again makes a new one.
  assertEquals((await rpc("unshare_note", { p_note: root }, B)).status, 204);
  assertEquals((await rpc("shared_note", { p_slug: slug }, null)).body.title, "Trip plan", "another user can't stop it");
  assertEquals((await rpc("unshare_note", { p_note: root }, A)).status, 204);
  assertEquals((await rpc("shared_note", { p_slug: slug }, null)).body, null);
  assertEquals((await files(slug)).status, 404);
  const again = (await rpc("share_note", { p_note: root }, A)).body;
  assertNotEquals(again, slug);

  // Junk slugs are just not found.
  assertEquals((await rpc("shared_note", { p_slug: "x' or 1=1 --" }, null)).body, null);
  assertEquals((await files("short")).status, 404);
});

Deno.test("who shared it: name, email and photo, never the account id or a relay address", async () => {
  const postgres = (await import("npm:postgres@3.4.5")).default;
  const sql = postgres(Deno.env.get("PANE_DB_URL")!, { max: 1, prepare: false });
  try {
    const a = uid(A), b = uid(B);
    await sql`delete from public.profiles where user_id in (${a}, ${b})`;
    await sql`delete from public.pane_rate where user_id in (${a}, ${b})`;
    const hex = () => crypto.randomUUID().replaceAll("-", "");
    const upload = (jwt: string, name: string, type = "image/jpeg") =>
      fetch(`${API}/storage/v1/object/avatars/${name}`, {
        method: "POST", headers: { apikey: ANON, authorization: `Bearer ${jwt}`, "content-type": type }, body: new Uint8Array([255, 216, 255, 224]),
      });

    // Photos: random names only (no account id in the path), JPEG/PNG only.
    const photo = `${hex()}.jpg`;
    const up = await upload(A, photo);
    assert(up.ok, await up.text());
    const withId = await upload(A, `${a}/${hex()}.jpg`);
    assert(!withId.ok, "a path with the account id is refused");
    await withId.body?.cancel();
    const html = await upload(A, `${hex()}.jpg`, "text/html");
    assert(!html.ok, "only images");
    await html.body?.cancel();
    // Nobody else can remove it, and nobody can list the bucket.
    const del = await fetch(`${API}/storage/v1/object/avatars`, {
      method: "DELETE", headers: { apikey: ANON, authorization: `Bearer ${B}`, "content-type": "application/json" }, body: JSON.stringify({ prefixes: [photo] }),
    });
    assertEquals((await del.json()).length ?? 0, 0, "another user deletes nothing");
    const list = await fetch(`${API}/storage/v1/object/list/avatars`, {
      method: "POST", headers: { apikey: ANON, authorization: `Bearer ${ANON}`, "content-type": "application/json" }, body: JSON.stringify({ prefix: "" }),
    });
    assertEquals((await list.json()).length ?? 0, 0, "strangers can't list photos");
    // Anyone can load it by its exact name (that's how the share page shows it).
    const pub = await fetch(`${API}/storage/v1/object/public/avatars/${photo}`);
    assertEquals(pub.status, 200);
    await pub.body?.cancel();

    // The profile: only yours, validated.
    assertEquals((await rest("profiles", A, { method: "POST", body: JSON.stringify({ display_name: "Emil W", avatar_path: photo }) })).status, 201);
    assertNotEquals((await rest("profiles", B, { method: "POST", body: JSON.stringify({ user_id: a, display_name: "Mallory" }) })).status, 201);
    assertNotEquals((await rest(`profiles?user_id=eq.${a}`, A, { method: "PATCH", body: JSON.stringify({ display_name: "  padded  " }) })).status, 200);
    assertNotEquals((await rest(`profiles?user_id=eq.${a}`, A, { method: "PATCH", body: JSON.stringify({ display_name: "x".repeat(61) }) })).status, 200);
    assertEquals((await rest(`profiles?user_id=eq.${a}`, B)).body.length, 0, "other users can't read it");
    assertEquals((await rest(`profiles?user_id=eq.${a}`, null)).status >= 400 || (await rest(`profiles?user_id=eq.${a}`, null)).body.length === 0, true);

    const mine = await note(A, "Recipe\n\nFlour.");
    const slug = (await rpc("share_note", { p_note: mine }, A)).body as string;
    const page = (await rpc("shared_note", { p_slug: slug }, null)).body;
    assertEquals(page.shared_by.name, "Emil W");
    assertEquals(page.shared_by.avatar, photo);
    assert(typeof page.shared_by.email === "string" && page.shared_by.email.includes("@"));
    assertEquals(Object.keys(page.shared_by).sort(), ["avatar", "email", "name"]);
    assert(!JSON.stringify(page).includes(a), "the account id never appears");

    // An Apple private relay address is never shown; with no name, nothing identifies them.
    const [{ email: before }] = await sql`select email from auth.users where id = ${b}`;
    await sql`update auth.users set email = 'abc123@privaterelay.appleid.com' where id = ${b}`;
    try {
      const theirs = await note(B, "Theirs\n\nHi");
      const s2 = (await rpc("share_note", { p_note: theirs }, B)).body as string;
      const p2 = (await rpc("shared_note", { p_slug: s2 }, null)).body;
      assertEquals(p2.shared_by, { name: null, email: null, avatar: null });
      await rpc("unshare_note", { p_note: theirs }, B);
    } finally {
      await sql`update auth.users set email = ${before} where id = ${b}`;
    }

    // Stopped links show nothing at all, sharer included.
    await rpc("unshare_note", { p_note: mine }, A);
    assertEquals((await rpc("shared_note", { p_slug: slug }, null)).body, null);
  } finally {
    await sql.end();
  }
});
