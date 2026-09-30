// Share links end to end against the LOCAL stack: scripts/share-e2e.sh
//
// Notes are sealed with the account's key, so a shared page shows the copy the owner's device
// publishes (share_note's p_copy, publish_share_file), and share-files serves only that copy.
import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { recoveryKEK, toBase64, Vault, verifierOf, keyIdOf, wrap, type Bytes } from "../_shared/e2ee.ts";
import { previewOf, titleOf } from "../mcp/notes.ts";

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

/** The test account's data key: fixed per account, so a second run finds the same key. */
async function dataKey(user: string): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`share-e2e|${user}`)));
}

const vaults = new Map<string, Vault>();
async function vault(jwt: string): Promise<Vault> {
  const user = uid(jwt);
  const known = vaults.get(user);
  if (known) return known;
  const dk = await dataKey(user);
  const recovery = crypto.getRandomValues(new Uint8Array(16));
  const made = await rpc("create_account_key", {
    p_key_id: await keyIdOf(dk), p_verifier: await verifierOf(dk, user),
    p_recovery_wrap: await wrap(dk, await recoveryKEK(recovery, user), "recovery", user), p_generation: 0,
  }, jwt);
  assertEquals(made.status, 200, JSON.stringify(made.body));
  assertEquals(made.body[0].key_id, await keyIdOf(dk), "this account has a key from elsewhere: reset the local stack");
  const v = await Vault.from(dk, user);
  vaults.set(user, v);
  return v;
}

async function note(jwt: string, body: string, extra: Record<string, unknown> = {}) {
  const v = await vault(jwt);
  const id = crypto.randomUUID();
  const r = await rest("notes", jwt, { method: "POST", body: JSON.stringify({
    id, body_ct: await v.sealBody(id, body), head_ct: await v.sealHead(id, { title: titleOf(body), preview: previewOf(body) }), ...extra,
  }) });
  assertEquals(r.status, 201, JSON.stringify(r.body));
  return id;
}

/** A file the account owns: its row (sealed name and type) and its published copy's bytes. */
async function attachment(jwt: string, name: string) {
  const v = await vault(jwt);
  const id = crypto.randomUUID();
  const r = await rest("attachments", jwt, { method: "POST", body: JSON.stringify({
    id, size: 4, storage_path: `${uid(jwt)}/${id}`, meta_ct: await v.sealFileMeta(id, { name, type: "public.png", size: 4 }),
  }) });
  assertEquals(r.status, 201, JSON.stringify(r.body));
  return id;
}

type Copy = { title: string; body: string; pages?: { id: string; parent_id: string; title: string; body: string }[]; files?: string[] };
const copyOf = (body: string, more: Omit<Copy, "title" | "body"> = {}): Copy => ({ title: titleOf(body), body, ...more });

async function share(jwt: string, note: string, subnotes: boolean, copy: Copy): Promise<string> {
  const r = await rpc("share_note", { p_note: note, p_include_subnotes: subnotes, p_copy: copy }, jwt);
  assertEquals(r.status, 200, JSON.stringify(r.body));
  return r.body.slug as string;
}

const PNG = new Uint8Array([137, 80, 78, 71]);

async function files(slug: string, sub?: string) {
  const res = await fetch(`${API}/functions/v1/share-files?slug=${slug}${sub ? `&sub=${sub}` : ""}`);
  return { status: res.status, body: await res.json() };
}
async function fileBytes(slug: string, file: string, sub?: string) {
  return await fetch(`${API}/functions/v1/share-files?slug=${slug}&file=${file}${sub ? `&sub=${sub}` : ""}`);
}

Deno.test("a shared note, its sub-notes and its files", async () => {
  // A picture the page embeds, one published but no longer embedded, and one never published.
  const shown = await attachment(A, "shown.png"), dropped = await attachment(A, "dropped.png"), hidden = await attachment(A, "hidden.png");
  const rootBody = `Trip plan\n\nDay one.\n\n![shown.png](pane-file:${shown})`;
  const root = await note(A, rootBody);
  const child = await note(A, "Hotel\n\nRoom 12", { parent_id: root });
  const grandchild = await note(A, "Receipt\n\nPaid", { parent_id: child });
  const unrelated = await note(A, "Private\n\nnot shared");
  const theirs = await note(B, "B's note\n\nsecret");
  const pages = [
    { id: child, parent_id: root, title: "Hotel", body: "Hotel\n\nRoom 12" },
    { id: grandchild, parent_id: child, title: "Receipt", body: `Receipt\n\nPaid\n\n[dropped.png](pane-file:${dropped})` },
    // Pages that aren't the owner's live notes are left out.
    { id: theirs, parent_id: root, title: "B's note", body: "secret" },
  ];

  // Anyone else can't share your note; strangers can't either.
  assertNotEquals((await rpc("share_note", { p_note: root, p_include_subnotes: false, p_copy: copyOf(rootBody) }, B)).status, 200);
  assertNotEquals((await rpc("share_note", { p_note: root, p_include_subnotes: false, p_copy: copyOf(rootBody) }, null)).status, 200);

  const first = await rpc("share_note", { p_note: root, p_include_subnotes: false, p_copy: copyOf(rootBody, { files: [shown] }) }, A);
  assertEquals(first.status, 200, JSON.stringify(first.body));
  const slug = first.body.slug as string;
  assert(/^[A-Za-z0-9_-]{24}$/.test(slug), slug);
  assertEquals(first.body.missing_files, [shown], "asks for the file's copy");
  assertEquals((await rpc("publish_share_file", { p_slug: slug, p_attachment: shown, p_filename: "shown.png", p_content_type: "image/png", p_content: toBase64(PNG) }, A)).status, 204);
  assertNotEquals((await rpc("publish_share_file", { p_slug: slug, p_attachment: shown, p_filename: "x.png", p_content_type: "image/png", p_content: toBase64(PNG) }, B)).status, 204,
    "only the owner publishes files");
  assertEquals(await share(A, root, false, copyOf(rootBody, { files: [shown] })), slug, "reuses the live link");
  assertEquals((await rest(`note_shares?slug=eq.${slug}`, null)).body?.length ?? 0, 0, "anon sees no shares");
  assertEquals((await rest(`note_shares?slug=eq.${slug}`, B)).body.length, 0, "other users see no shares");
  assertEquals((await rest(`note_share_files?slug=eq.${slug}`, A)).status >= 400 || (await rest(`note_share_files?slug=eq.${slug}`, A)).body.length === 0, true,
    "copies are read only through shared_file");

  const page = (await rpc("shared_note", { p_slug: slug }, null)).body;
  assertEquals(page.title, "Trip plan");
  assert(page.body.includes("Day one."));
  assertEquals(page.subnotes, []);
  assertEquals(Object.keys(page).sort(), ["body", "include_subnotes", "is_sub", "root_title", "shared_by", "subnotes", "title", "updated_at"]);
  assertEquals((await rpc("shared_note", { p_slug: slug, p_sub: child }, null)).body, null, "sub-notes need the option");
  assertEquals((await rpc("shared_file", { p_slug: slug, p_sub: null, p_file: shown }, null)).status >= 400, true, "shared_file is the function's only");

  // Files: only what the page embeds, served from its copy.
  const f = await files(slug);
  assertEquals(f.status, 200);
  assertEquals(Object.keys(f.body.files), [shown]);
  assertEquals(f.body.files[shown], { path: `/functions/v1/share-files?slug=${slug}&file=${shown}`, name: "shown.png", type: "image/png", size: 4 });
  const img = await fetch(API + f.body.files[shown].path);
  assertEquals(img.status, 200);
  assertEquals(img.headers.get("content-type"), "image/png");
  assertEquals(img.headers.get("x-content-type-options"), "nosniff");
  assert(img.headers.get("content-disposition")!.startsWith('inline; filename="shown.png"'));
  assertEquals(new Uint8Array(await img.arrayBuffer()), PNG);
  const notPublished = await fileBytes(slug, hidden);
  assertEquals(notPublished.status, 404);
  await notPublished.body?.cancel();

  // With sub-notes: children and deeper, never unrelated notes or someone else's.
  const withSubsCopy = copyOf(rootBody, { pages, files: [shown, dropped] });
  const again = await rpc("share_note", { p_note: root, p_include_subnotes: true, p_copy: withSubsCopy }, A);
  assertEquals(again.body.slug, slug);
  assertEquals(again.body.missing_files, [dropped]);
  await rpc("publish_share_file", { p_slug: slug, p_attachment: dropped, p_filename: "dropped.png", p_content_type: "public.png", p_content: toBase64(PNG) }, A);
  const withSubs = (await rpc("shared_note", { p_slug: slug }, null)).body;
  assertEquals(withSubs.subnotes.map((s: { title: string }) => s.title), ["Hotel"]);
  assertEquals((await rpc("shared_note", { p_slug: slug, p_sub: child }, null)).body.title, "Hotel");
  assertEquals((await rpc("shared_note", { p_slug: slug, p_sub: grandchild }, null)).body.title, "Receipt");
  assertEquals((await rpc("shared_note", { p_slug: slug, p_sub: unrelated }, null)).body, null);
  assertEquals((await rpc("shared_note", { p_slug: slug, p_sub: theirs }, null)).body, null);
  assertEquals((await files(slug, unrelated)).status, 404);

  // A file belongs to the page that embeds it: the sub-page serves it, the root page doesn't.
  const sub = await files(slug, grandchild);
  assertEquals(Object.keys(sub.body.files), [dropped]);
  assertEquals(sub.body.files[dropped].path, `/functions/v1/share-files?slug=${slug}&file=${dropped}&sub=${grandchild}`);
  const fromSub = await fetch(API + sub.body.files[dropped].path);
  assertEquals(fromSub.status, 200);
  await fromSub.body?.cancel();
  const fromRoot = await fileBytes(slug, dropped);
  assertEquals(fromRoot.status, 404);
  await fromRoot.body?.cancel();

  // Trashing the note hides every page of the link, and its files.
  await rest(`notes?id=eq.${root}`, A, { method: "PATCH", body: JSON.stringify({ trashed_at: new Date().toISOString() }) });
  assertEquals((await rpc("shared_note", { p_slug: slug }, null)).body, null);
  assertEquals((await rpc("shared_note", { p_slug: slug, p_sub: child }, null)).body, null);
  assertEquals((await files(slug)).status, 404);
  const gone = await fileBytes(slug, shown);
  assertEquals(gone.status, 404);
  await gone.body?.cancel();
  assertNotEquals((await rpc("share_note", { p_note: root, p_include_subnotes: false, p_copy: copyOf(rootBody) }, A)).status, 200,
    "a trashed note can't be shared");

  // Stopping kills the link for good; sharing again makes a new one.
  await rest(`notes?id=eq.${root}`, A, { method: "PATCH", body: JSON.stringify({ trashed_at: null }) });
  assertEquals((await rpc("unshare_note", { p_note: root }, B)).status, 204);
  assertEquals((await rpc("unshare_note", { p_note: root }, A)).status, 204);
  assertEquals((await rpc("shared_note", { p_slug: slug }, null)).body, null);
  assertEquals((await files(slug)).status, 404);
  assertNotEquals(await share(A, root, false, copyOf(rootBody)), slug);

  // Junk slugs and ids are just not found.
  assertEquals((await rpc("shared_note", { p_slug: "x' or 1=1 --" }, null)).body, null);
  assertEquals((await files("short")).status, 404);
  const junk = await fetch(`${API}/functions/v1/share-files?slug=${slug}&file=../../etc`);
  assertEquals(junk.status, 404);
  await junk.body?.cancel();
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
    const slug = await share(A, mine, false, copyOf("Recipe\n\nFlour."));
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
      const s2 = await share(B, theirs, false, copyOf("Theirs\n\nHi"));
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
