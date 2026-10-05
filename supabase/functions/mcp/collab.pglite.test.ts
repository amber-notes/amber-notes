// Collaboration (prototype, 20261005120000_collaboration.sql) on the whole schema in an in-process
// Postgres, with the real formats from _shared/collab.ts: who can read and write a shared note,
// invites sealed between identity keys, removal rotating the key, and invite links.
//   cd supabase/functions/mcp && deno test -A collab.pglite.test.ts
import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { asUser, newUser, schemaDB } from "./pglite.ts";
import { aesKey, fromBase64, hex, keyIdOf, newDataKey, open, seal, toBase64 } from "../_shared/e2ee.ts";
import {
  bytes, identityContext, linkKeys, newIdentity, noteKeyContext, open3, openNoteKey, safetyCode, seal3, sealNoteKey, text,
} from "../_shared/collab.ts";

const app = (pg: PGlite, me: string, sql: string, params: unknown[] = []) => asUser<any>(pg, me, sql, params);

async function refused(p: Promise<unknown>, what: string) {
  const e = await assertRejects(() => p);
  assertStringIncludes((e as Error).message, what);
}

/** A person: an account with a data key, a profile name and a published identity key. */
async function person(pg: PGlite, name: string) {
  const id = await newUser(pg);
  await pg.query(`update auth.users set email = $2 where id = $1`, [id, `${name.toLowerCase()}@example.com`]);
  const dk = newDataKey(), keyId = await keyIdOf(dk);
  await app(pg, id, `select * from public.create_account_key($1, $2, $3, 0)`, [keyId, "00".repeat(32), `amb2.${keyId}.${toBase64(crypto.getRandomValues(new Uint8Array(48)))}`]);
  await app(pg, id, `insert into public.profiles (display_name) values ($1)`, [name]);
  const identity = await newIdentity();
  const privateWrap = await seal(toBase64(identity.d), await aesKey(dk), keyId, identityContext(id));
  await app(pg, id, `select public.collab_publish_identity($1, $2)`, [toBase64(identity.publicRaw), privateWrap]);
  return { id, name, dk, keyId, identity };
}
type Person = Awaited<ReturnType<typeof person>>;

const selfWrap = async (p: Person, nk: Uint8Array<ArrayBuffer>, note: string, epoch: number) =>
  await seal(toBase64(nk), await aesKey(p.dk), p.keyId, noteKeyContext(note, epoch));

async function share(pg: PGlite, owner: Person) {
  const note = crypto.randomUUID(), nk = newDataKey();
  const toSelf = await sealNoteKey(nk, owner.identity, owner.identity.publicRaw, { note, epoch: 1, from: owner.id, to: owner.id });
  const head = await seal3("h", bytes(JSON.stringify({ title: "Offsite plan" })), nk, note, 1);
  await app(pg, owner.id, `select public.collab_share($1, $2, $3, $4)`, [note, toSelf, await selfWrap(owner, nk, note, 1), head]);
  return { note, nk };
}

async function invite(pg: PGlite, owner: Person, email: string, note: string, nk: Uint8Array<ArrayBuffer>, role = "editor", epoch = 1) {
  const [found] = await app(pg, owner.id, `select * from public.collab_find_person($1)`, [email]);
  const wrap = await sealNoteKey(nk, owner.identity, fromBase64(found.public_key), { note, epoch, from: owner.id, to: found.user_id });
  await app(pg, owner.id, `select public.collab_invite($1, $2, $3, $4, $5)`, [note, found.user_id, role, wrap, epoch]);
  return found;
}

/** What the invitee's device does: open the wrap (checking who sealed it), seal NK to itself, accept. */
async function accept(pg: PGlite, me: Person, note: string) {
  const [row] = await app(pg, me.id, `select * from public.note_members where note_id = $1 and user_id = $2`, [note, me.id]);
  const members = await app(pg, me.id, `select * from public.collab_members($1)`, [note]);
  const sealer = members.find((m: any) => m.user_id === row.wrapped_by);
  const nk = await openNoteKey(row.key_wrap, me.identity, fromBase64(sealer.public_key),
    { note, epoch: row.epoch, from: row.wrapped_by, to: me.id });
  await app(pg, me.id, `select public.collab_accept($1, $2)`, [note, await selfWrap(me, nk, note, row.epoch)]);
  return nk;
}

async function push(pg: PGlite, me: Person, note: string, nk: Uint8Array<ArrayBuffer>, epoch: number, change: string) {
  const ct = await seal3("u", bytes(change), nk, note, epoch, me.id);
  const [r] = await app(pg, me.id, `insert into public.note_updates (note_id, epoch, ct) values ($1, $2, $3) returning id`, [note, epoch, ct]);
  return r.id;
}

Deno.test("an invite reaches only the invitee, who can open it, read and write", async () => {
  const pg = await schemaDB();
  const emil = await person(pg, "Emil"), sara = await person(pg, "Sara"), eve = await person(pg, "Eve");
  const { note, nk } = await share(pg, emil);
  const found = await invite(pg, emil, "SARA@example.com ", note, nk);
  assertEquals(found.display_name, "Sara");

  const nkSara = await accept(pg, sara, note);
  assertEquals(hex(nkSara), hex(nk));
  const id = await push(pg, sara, note, nkSara, 1, "sara types");
  const [u] = await app(pg, emil.id, `select * from public.note_updates where id = $1`, [id]);
  assertEquals(u.author_id, sara.id);
  assertEquals(text(await open3("u", u.ct, nk, note, u.author_id)), "sara types");
  // The author is in the AAD: the server can't pass Sara's change off as Emil's.
  await assertRejects(() => open3("u", u.ct, nk, note, emil.id));

  // Both see who is in the note, with names and keys, and the same safety code.
  const members = await app(pg, sara.id, `select * from public.collab_members($1)`, [note]);
  assertEquals(members.map((m: any) => [m.display_name, m.role, m.accepted]), [["Emil", "owner", true], ["Sara", "editor", true]]);
  assertEquals(await safetyCode(emil.identity.publicRaw, sara.identity.publicRaw), await safetyCode(sara.identity.publicRaw, emil.identity.publicRaw));

  // Eve sees nothing and can write nothing.
  assertEquals(await app(pg, eve.id, `select * from public.shared_notes`), []);
  assertEquals(await app(pg, eve.id, `select * from public.note_updates`), []);
  assertEquals(await app(pg, eve.id, `select * from public.collab_members($1)`, [note]), []);
  await refused(push(pg, eve, note, nk, 1, "x"), "");
  // Nor can Sara, an editor, invite.
  await refused(invite(pg, sara, "eve@example.com", note, nk), "Only the owner");
});

Deno.test("the inviter is proven: a wrap the server made up doesn't open", async () => {
  const pg = await schemaDB();
  const emil = await person(pg, "Emil"), sara = await person(pg, "Sara");
  const { note } = await share(pg, emil);
  const server = await newIdentity();
  const fake = await sealNoteKey(newDataKey(), server, sara.identity.publicRaw, { note, epoch: 1, from: emil.id, to: sara.id });
  await assertRejects(() => openNoteKey(fake, sara.identity, emil.identity.publicRaw, { note, epoch: 1, from: emil.id, to: sara.id }));
  // And a real wrap moved to another epoch or person doesn't open either.
  const nk = newDataKey();
  const real = await sealNoteKey(nk, emil.identity, sara.identity.publicRaw, { note, epoch: 1, from: emil.id, to: sara.id });
  await assertRejects(() => openNoteKey(real, sara.identity, emil.identity.publicRaw, { note, epoch: 2, from: emil.id, to: sara.id }));
});

Deno.test("a viewer reads but can't write; an old key is refused after a removal", async () => {
  const pg = await schemaDB();
  const emil = await person(pg, "Emil"), sara = await person(pg, "Sara"), jonas = await person(pg, "Jonas");
  const { note, nk } = await share(pg, emil);
  await invite(pg, emil, "sara@example.com", note, nk, "editor");
  await invite(pg, emil, "jonas@example.com", note, nk, "viewer");
  await accept(pg, sara, note);
  await accept(pg, jonas, note);
  await push(pg, emil, note, nk, 1, "hello");
  assertEquals((await app(pg, jonas.id, `select * from public.note_updates`)).length, 1);
  await refused(push(pg, jonas, note, nk, 1, "nope"), "view this note but not change it");

  // Emil removes Sara: a new key, sealed to everyone who stays, in one call.
  const nk2 = newDataKey();
  const wraps = [
    { user_id: emil.id, key_wrap: await sealNoteKey(nk2, emil.identity, emil.identity.publicRaw, { note, epoch: 2, from: emil.id, to: emil.id }) },
    { user_id: jonas.id, key_wrap: await sealNoteKey(nk2, emil.identity, jonas.identity.publicRaw, { note, epoch: 2, from: emil.id, to: jonas.id }) },
  ];
  await refused(app(pg, emil.id, `select public.collab_remove($1, $2, 2, $3)`, [note, sara.id, JSON.stringify(wraps.slice(0, 1))]), "Every remaining member");
  await app(pg, emil.id, `select public.collab_remove($1, $2, 2, $3)`, [note, sara.id, JSON.stringify(wraps)]);
  assertEquals(await app(pg, sara.id, `select * from public.note_updates`), []);
  await refused(push(pg, sara, note, nk, 1, "still here?"), "");
  // Emil's device still holding the old key is told to open the note again.
  await refused(push(pg, emil, note, nk, 1, "old key"), "key changed");
  await push(pg, emil, note, nk2, 2, "new key");
  const nkJonas = await accept(pg, jonas, note);
  assertEquals(hex(nkJonas), hex(nk2));
});

Deno.test("an invite link works only with its secret, which the server never gets", async () => {
  const pg = await schemaDB();
  const emil = await person(pg, "Emil"), sara = await person(pg, "Sara");
  const { note, nk } = await share(pg, emil);
  const link = "Ab".repeat(11), secret = crypto.getRandomValues(new Uint8Array(16));
  const { answer, key } = await linkKeys(secret, link);
  const answerHash = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(answer.match(/../g)!, (h) => parseInt(h, 16)))));
  const wrap = await seal(toBase64(nk), key, await keyIdOf(nk), `invite:${link}`);
  await app(pg, emil.id, `select public.collab_create_link($1, $2, 'editor', 1, $3, $4)`, [link, note, answerHash, wrap]);

  // Sara's device has the link (the secret came in the fragment).
  await refused(app(pg, sara.id, `select * from public.collab_open_link($1, $2)`, [link, "ab".repeat(32)]), "expired");
  const [opened] = await app(pg, sara.id, `select * from public.collab_open_link($1, $2)`, [link, answer]);
  const nkSara = fromBase64(await open(opened.key_wrap, (await linkKeys(secret, link)).key, `invite:${link}`));
  assertEquals(hex(nkSara), hex(nk));
  const toSelf = await sealNoteKey(nkSara, sara.identity, sara.identity.publicRaw, { note, epoch: 1, from: sara.id, to: sara.id });
  await app(pg, sara.id, `select public.collab_join_link($1, $2, $3, $4)`, [link, answer, toSelf, await selfWrap(sara, nkSara, note, 1)]);
  const members = await app(pg, emil.id, `select * from public.collab_members($1)`, [note]);
  assert(members.some((m: any) => m.user_id === sara.id && m.role === "editor"));

  // Reset Link (a new key, nobody removed): the old link stops working.
  const nk2 = newDataKey();
  const wraps = [emil, sara].map(async (p) => ({ user_id: p.id, key_wrap: await sealNoteKey(nk2, emil.identity, p.identity.publicRaw, { note, epoch: 2, from: emil.id, to: p.id }) }));
  await app(pg, emil.id, `select public.collab_remove($1, null, 2, $2)`, [note, JSON.stringify(await Promise.all(wraps))]);
  await refused(app(pg, sara.id, `select * from public.collab_open_link($1, $2)`, [link, answer]), "expired");
  // Edit turned off: same.
  await app(pg, emil.id, `select public.collab_create_link($1, $2, 'editor', 2, $3, $4)`, [link, note, answerHash, wrap]);
  await app(pg, emil.id, `select public.collab_stop_link($1)`, [note]);
  await refused(app(pg, sara.id, `select * from public.collab_open_link($1, $2)`, [link, answer]), "expired");
});

Deno.test("a sealed link: only the sealed copy is stored, anyone reads it, rotation and stop take the old one down", async () => {
  const { sealCopy, openCopy, toB64url } = await import("../../../web/lib/sealed-share.ts");
  const pg = await schemaDB();
  const emil = await person(pg, "Emil");
  const note = crypto.randomUUID();
  const anon = (sql: string, params: unknown[]) => pg.transaction(async (tx) => { await tx.exec(`set local role anon`); return (await tx.query<any>(sql, params)).rows; });
  const link = async () => {
    const id = toB64url(crypto.getRandomValues(new Uint8Array(16))), secret = crypto.getRandomValues(new Uint8Array(16));
    const ct = await sealCopy({ v: 1, title: "Habit tracker", body: "Habit tracker\n\n| Date | Walk |", page: "<p>app</p>", updated_at: "2026-10-05" }, id, secret);
    await app(pg, emil.id, `select public.publish_sealed_link($1, $2, $3)`, [id, note, ct]);
    return { id, secret: toB64url(secret) };
  };
  const first = await link();
  const [row] = await anon(`select * from public.sealed_link($1)`, [first.id]);
  assert(!row.ct.includes("Habit"));
  assertEquals((await openCopy(row.ct, first.id, first.secret)).page, "<p>app</p>");
  await assertRejects(() => openCopy(row.ct, first.id, toB64url(crypto.getRandomValues(new Uint8Array(16)))));
  // A new link for the same note: the old address stops at once.
  const second = await link();
  assertEquals(await anon(`select * from public.sealed_link($1)`, [first.id]), []);
  assertEquals((await anon(`select * from public.sealed_link($1)`, [second.id])).length, 1);
  await app(pg, emil.id, `select public.stop_sealed_link($1)`, [note]);
  assertEquals(await anon(`select * from public.sealed_link($1)`, [second.id]), []);
  // Nobody else can publish over it or read the table.
  const eve = await person(pg, "Eve");
  assertEquals(await app(pg, eve.id, `select * from public.sealed_links`), []);
});

Deno.test("a shared template is public, carries key names but never key values, and stops", async () => {
  const pg = await schemaDB();
  const emil = await person(pg, "Emil");
  const note = crypto.randomUUID();
  const t = { v: 1, title: "Habit tracker", note: "Habit tracker\n\n| Date | Walk |\n| --- | --- |\n", needs: { keys: [{ name: "Strava API key", host: "www.strava.com" }] } };
  await app(pg, emil.id, `select public.publish_template('AbCdEfGhIjKlMnOp', $1, 'Emil', $2)`, [note, JSON.stringify(t)]);
  const anon = (sql: string, params: unknown[]) => pg.transaction(async (tx) => { await tx.exec(`set local role anon`); return (await tx.query<any>(sql, params)).rows; });
  const [row] = await anon(`select * from public.shared_template($1)`, ["AbCdEfGhIjKlMnOp"]);
  assertEquals(row.template.needs.keys[0].name, "Strava API key");
  const leaky = { ...t, needs: { keys: [{ name: "Strava API key", host: "www.strava.com", value: "sk_live_123" }] } };
  await refused(app(pg, emil.id, `select public.publish_template('AbCdEfGhIjKlMnOq', $1, 'Emil', $2)`, [crypto.randomUUID(), JSON.stringify(leaky)]), "never carries");
  const sneaky = { ...t, needs: { keys: [{ name: "Strava API key", value: "sk_live_123" }] } };
  await refused(app(pg, emil.id, `select public.publish_template('AbCdEfGhIjKlMnOr', $1, 'Emil', $2)`, [crypto.randomUUID(), JSON.stringify(sneaky)]), "never carries");
  await app(pg, emil.id, `select public.stop_template($1)`, [note]);
  assertEquals(await anon(`select * from public.shared_template($1)`, ["AbCdEfGhIjKlMnOp"]), []);
});
