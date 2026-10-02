// Add a device (20261002150000_add_device.sql) on the whole schema in an in-process Postgres
// (PGlite), with the real formats from _shared/e2ee.ts: the same-account rule, single use, expiry,
// wrong answers, rate limits, and the list of devices that hold the key.
//   cd supabase/functions/mcp && deno test -A device_add.pglite.test.ts
import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { asUser, newUser, schemaDB } from "./pglite.ts";
import {
  addDeviceAnswerHash, addDeviceCodePrk, addDeviceCodeText, addDevicePairing, addDeviceQR, addDeviceTag, canonicalAddDeviceCode,
  aesKey, deviceContext, hex, keyDeviceRemovalTag, keyDeviceTag, keyIdOf, newDataKey, newHandoffKeys, open, openDeviceKey, openDeviceName,
  readAddDeviceQR, seal, sealDeviceKey, sealDeviceName, toBase64, fromBase64, verifierOf, type Bytes,
} from "../_shared/e2ee.ts";

const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const box = (key: string) => `amb2.${key}.${toBase64(rand(48))}`;
const app = (pg: PGlite, me: string, sql: string, params: unknown[] = []) => asUser<any>(pg, me, sql, params);

async function refused(p: Promise<unknown>, text: string) {
  const e = await assertRejects(() => p);
  assertStringIncludes((e as Error).message, text);
}

/** An account with a real key: the stored form a device holds, and the server's row. */
async function account(pg: PGlite) {
  const me = await newUser(pg);
  const dataKey = newDataKey(), recovery = rand(16);
  const keyId = await keyIdOf(dataKey);
  const verifier = await verifierOf(dataKey, me);
  await app(pg, me, `select * from public.create_account_key($1, $2, $3, 0)`, [keyId, verifier, box(keyId)]);
  return { me, dataKey, keyId, verifier, stored: new Uint8Array([2, ...dataKey, ...recovery, 0, 0, 0, 0]) as Bytes };
}

/** What the new device does: a key pair, both pairing secrets, and the request. */
async function request(pg: PGlite, me: string, o: { device?: string; name?: string; platform?: string } = {}) {
  const id = crypto.randomUUID(), device = o.device ?? crypto.randomUUID();
  const name = o.name ?? "Sara’s MacBook Air", platform = o.platform ?? "macos";
  const keys = await newHandoffKeys();
  const secret = rand(16), codeText = addDeviceCodeText(rand(8));
  const scan = await addDevicePairing(secret, me);
  const code = await addDevicePairing(await addDeviceCodePrk(canonicalAddDeviceCode(codeText)!, me), me);
  const pickup = hex(rand(32));
  const r = { requestId: id, platform, publicRaw: keys.publicRaw };
  const [row] = await app(pg, me, `select public.device_add_request($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) as expires_at`,
    [id, device, platform, toBase64(keys.publicRaw),
      await addDeviceAnswerHash(scan.answer), await addDeviceTag(scan.bind, r), await sealDeviceName(name, scan.bind, id, platform),
      await addDeviceAnswerHash(code.answer), await addDeviceTag(code.bind, r), await sealDeviceName(name, code.bind, id, platform),
      await addDeviceAnswerHash(pickup)]);
  return { id, device, keys, qr: addDeviceQR(secret), codeText, scan, code, pickup, expiresAt: row.expires_at as Date };
}

/** What the approving device does with the QR text it scanned: find, check, seal, answer. */
async function approve(pg: PGlite, me: string, stored: Bytes, qr: string) {
  const pairing = await addDevicePairing(readAddDeviceQR(qr)!, me);
  const [found] = await app(pg, me, `select * from public.device_add_find($1)`, [pairing.answer]);
  if (!found) return { found: false as const };
  const publicRaw = fromBase64(found.public_key);
  const tagOK = found.tag === await addDeviceTag(pairing.bind, { requestId: found.id, platform: found.platform, publicRaw });
  const name = await openDeviceName(found.name, pairing.bind, found.id, found.platform);
  const sealed = await sealDeviceKey(stored, publicRaw, pairing.bind, found.id, me);
  const [{ state }] = await app(pg, me, `select public.device_add_answer($1, $2, $3, $4) as state`, [found.id, pairing.answer, sealed, crypto.randomUUID()]);
  return { found: true as const, tagOK, name, state, via: found.via as string };
}

const finish = (pg: PGlite, me: string, id: string, secret: string) => app(pg, me, `select public.device_add_done($1, $2)`, [id, secret]);

const pickup = async (pg: PGlite, me: string, id: string, secret: string) =>
  (await app(pg, me, `select public.device_add_pickup($1, $2) as r`, [id, secret]))[0].r as { state: string; sealed?: string; via?: string };

Deno.test("the key goes from a device that has it to the one that showed the code, and the server only holds ciphertext", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const n = await request(pg, a.me);
  assertEquals((await pickup(pg, a.me, n.id, n.pickup)).state, "waiting");
  const done = await approve(pg, a.me, a.stored, n.qr);
  assertEquals(done, { found: true, tagOK: true, name: "Sara’s MacBook Air", state: "added", via: "scan" });
  // The row holds nothing that opens the key: no data key bytes, and the sealed box needs the new device's private key.
  const { rows } = await pg.query<Record<string, unknown>>(`select * from public.device_adds where id = $1`, [n.id]);
  const dump = JSON.stringify(rows[0]);
  assert(!dump.includes(toBase64(a.dataKey)) && !dump.includes(hex(a.dataKey)) && !dump.includes(n.scan.answer) && !dump.includes(toBase64(n.scan.bind)));
  // Nor the device's name: it's sealed under the pairing secret.
  assert(!dump.includes("MacBook") && !dump.includes("Sara"));
  // The new device picks it up, opens it, and checks it against the account's verifier.
  const got = await pickup(pg, a.me, n.id, n.pickup);
  assertEquals([got.state, got.via], ["answered", "scan"]);
  const opened = await openDeviceKey(got.sealed!, n.keys.privateKey, n.scan.bind, n.id, a.me);
  assertEquals(opened, a.stored);
  assertEquals(await verifierOf(opened.slice(1, 33), a.me), a.verifier);
  // An answer lost on the way can be asked for again, until the device says it has the key. Then it's gone.
  assertEquals((await pickup(pg, a.me, n.id, n.pickup)).sealed, got.sealed);
  await finish(pg, a.me, n.id, n.pickup);
  assertEquals((await pickup(pg, a.me, n.id, n.pickup)).state, "taken");
  assertEquals((await pg.query<{ sealed: string | null }>(`select sealed from public.device_adds where id = $1`, [n.id])).rows[0].sealed, null);
  // Every device of the account hears a device was added.
  const notices = await app(pg, a.me, `select kind, what from public.account_notices`);
  assertEquals(notices, [{ kind: "device_added", what: "A device was added" }]);
});

Deno.test("the typed code finds the same request and seals under its own bind", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const n = await request(pg, a.me);
  // Typed sloppily on the approving Mac.
  const typed = n.codeText.toLowerCase().replace(/-/g, " ");
  const pairing = await addDevicePairing(await addDeviceCodePrk(canonicalAddDeviceCode(typed)!, a.me), a.me);
  const [found] = await app(pg, a.me, `select * from public.device_add_find($1)`, [pairing.answer]);
  assertEquals([found.id, found.via, found.platform], [n.id, "code", "macos"]);
  assertEquals(await openDeviceName(found.name, pairing.bind, n.id, "macos"), "Sara’s MacBook Air");
  assertEquals(found.tag, await addDeviceTag(pairing.bind, { requestId: n.id, platform: "macos", publicRaw: n.keys.publicRaw }));
  const sealed = await sealDeviceKey(a.stored, fromBase64(found.public_key), pairing.bind, n.id, a.me);
  assertEquals((await app(pg, a.me, `select public.device_add_answer($1, $2, $3, $4) as s`, [n.id, pairing.answer, sealed, crypto.randomUUID()]))[0].s, "added");
  const got = await pickup(pg, a.me, n.id, n.pickup);
  assertEquals(got.via, "code");
  assertEquals(await openDeviceKey(got.sealed!, n.keys.privateKey, n.code.bind, n.id, a.me), a.stored);
  // The QR's bind doesn't open what the code sealed.
  await assertRejects(() => openDeviceKey(got.sealed!, n.keys.privateKey, n.scan.bind, n.id, a.me));
});

Deno.test("same account only: another account can't find, answer, pick up or even see a request", async () => {
  const pg = await schemaDB();
  const a = await account(pg), other = await account(pg);
  const n = await request(pg, a.me);
  // Someone else scans the code with their own Amber Notes: nothing is found, with either account's derivation.
  assertEquals((await approve(pg, other.me, other.stored, n.qr)).found, false);
  assertEquals((await app(pg, other.me, `select * from public.device_add_find($1)`, [n.scan.answer])).length, 0);
  // Knowing the id and the answer isn't enough from another account.
  const sealed = await sealDeviceKey(other.stored, n.keys.publicRaw, n.scan.bind, n.id, a.me);
  assertEquals((await app(pg, other.me, `select public.device_add_answer($1, $2, $3, $4) as s`, [n.id, n.scan.answer, sealed, crypto.randomUUID()]))[0].s, "expired");
  assertEquals((await pickup(pg, other.me, n.id, n.pickup)).state, "gone");
  // The table itself is closed to every app session, the owner's included.
  await refused(app(pg, other.me, `select * from public.device_adds`), "permission denied");
  await refused(app(pg, a.me, `select * from public.device_adds`), "permission denied");
  await refused(app(pg, a.me, `update public.device_adds set sealed = null`), "permission denied");
  // The owner's request is untouched and still answers.
  assertEquals((await approve(pg, a.me, a.stored, n.qr)).state, "added");
  // An account without a key can't ask for one.
  const empty = await newUser(pg);
  await refused(request(pg, empty), "no key yet");
});

Deno.test("single use: a request is answered once, and the sealed key goes when the new device has it", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const n = await request(pg, a.me);
  assertEquals((await approve(pg, a.me, a.stored, n.qr)).state, "added");
  // Scanned again (a photo of the code, a second device): nothing to find, nothing to answer.
  assertEquals((await approve(pg, a.me, a.stored, n.qr)).found, false);
  const again = await sealDeviceKey(a.stored, n.keys.publicRaw, n.scan.bind, n.id, a.me);
  assertEquals((await app(pg, a.me, `select public.device_add_answer($1, $2, $3, $4) as s`, [n.id, n.scan.answer, again, crypto.randomUUID()]))[0].s, "expired");
  // A wrong pickup secret gets nothing, and can't make the sealed key go either.
  assertEquals((await pickup(pg, a.me, n.id, hex(rand(32)))).state, "gone");
  await finish(pg, a.me, n.id, hex(rand(32)));
  const other = await account(pg);
  await finish(pg, other.me, n.id, n.pickup);
  assertEquals((await pickup(pg, a.me, n.id, n.pickup)).state, "answered");
  await finish(pg, a.me, n.id, n.pickup);
  assertEquals((await pickup(pg, a.me, n.id, n.pickup)).state, "taken");
  // A new code on the same device replaces its old request.
  const first = await request(pg, a.me, { device: n.device });
  const second = await request(pg, a.me, { device: n.device });
  assertEquals((await approve(pg, a.me, a.stored, first.qr)).found, false);
  assertEquals((await pickup(pg, a.me, first.id, first.pickup)).state, "gone");
  assertEquals((await approve(pg, a.me, a.stored, second.qr)).state, "added");
});

Deno.test("a request expires after five minutes, and an answer for a key the account no longer has is refused", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const n = await request(pg, a.me);
  const life = (await pg.query<{ s: number }>(`select extract(epoch from expires_at - created_at)::int s from public.device_adds where id = $1`, [n.id])).rows[0].s;
  assertEquals(life, 300);
  await pg.query(`update public.device_adds set expires_at = now() - interval '1 second' where id = $1`, [n.id]);
  assertEquals((await approve(pg, a.me, a.stored, n.qr)).found, false);
  const sealed = await sealDeviceKey(a.stored, n.keys.publicRaw, n.scan.bind, n.id, a.me);
  assertEquals((await app(pg, a.me, `select public.device_add_answer($1, $2, $3, $4) as s`, [n.id, n.scan.answer, sealed, crypto.randomUUID()]))[0].s, "expired");
  assertEquals((await pickup(pg, a.me, n.id, n.pickup)).state, "expired");
  // An answer that landed just before the end is still collected just after it.
  const late = await request(pg, a.me);
  assertEquals((await approve(pg, a.me, a.stored, late.qr)).state, "added");
  await pg.query(`update public.device_adds set expires_at = now() - interval '1 second' where id = $1`, [late.id]);
  assertEquals((await pickup(pg, a.me, late.id, late.pickup)).state, "answered");
  // The account started fresh while a code was showing: the request was for the old key.
  const stale = await request(pg, a.me);
  await pg.query(`delete from public.account_keys where user_id = $1`, [a.me]);
  const k2 = hex(rand(8));
  await app(pg, a.me, `select * from public.create_account_key($1, $2, $3, 0)`, [k2, hex(rand(32)), box(k2)]);
  const pairing = await addDevicePairing(readAddDeviceQR(stale.qr)!, a.me);
  const s2 = await sealDeviceKey(a.stored, stale.keys.publicRaw, pairing.bind, stale.id, a.me);
  assertEquals((await app(pg, a.me, `select public.device_add_answer($1, $2, $3, $4) as s`, [stale.id, pairing.answer, s2, crypto.randomUUID()]))[0].s, "expired");
  assertEquals((await pickup(pg, a.me, stale.id, stale.pickup)).state, "gone");
  // Old requests are swept when a new one is made, and by the hourly job; an app session can't run the job.
  await pg.query(`update public.device_adds set expires_at = now() - interval '31 minutes'`);
  await request(pg, a.me);
  assertEquals((await pg.query(`select 1 from public.device_adds`)).rows.length, 1);
  await pg.query(`update public.device_adds set expires_at = now() - interval '2 hours'`);
  await refused(app(pg, a.me, `select public.pane_forget_device_adds()`), "permission denied");
  await pg.query(`select public.pane_forget_device_adds()`);
  assertEquals((await pg.query(`select 1 from public.device_adds`)).rows.length, 0);
});

Deno.test("five wrong answers end a request, and only well-formed sealed keys are stored", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const n = await request(pg, a.me);
  const good = await sealDeviceKey(a.stored, n.keys.publicRaw, n.scan.bind, n.id, a.me);
  const answer = (x: string, sealed = good) => app(pg, a.me, `select public.device_add_answer($1, $2, $3, $4) as s`, [n.id, x, sealed, crypto.randomUUID()]).then((r) => r[0].s);
  // Not a sealed device key: refused outright, the request stays open.
  await refused(answer(n.scan.answer, "amb2h." + good.slice(6)), "device_adds_sealed_check");
  await refused(answer(n.scan.answer, toBase64(a.stored)), "device_adds_sealed_check");
  for (let i = 0; i < 4; i++) assertEquals(await answer(hex(rand(32))), "wrong");
  assertEquals(await answer("not hex"), "wrong");
  // The right answer now comes too late, and the new device is told to show a new code.
  assertEquals(await answer(n.scan.answer), "expired");
  assertEquals((await app(pg, a.me, `select * from public.device_add_find($1)`, [n.scan.answer])).length, 0);
  assertEquals((await pickup(pg, a.me, n.id, n.pickup)).state, "expired");
});

Deno.test("rate limits: ten codes in ten minutes, twenty lookups or answers, per account", async () => {
  const pg = await schemaDB();
  const a = await account(pg), other = await account(pg);
  const device = crypto.randomUUID();
  for (let i = 0; i < 10; i++) await request(pg, a.me, { device });
  await refused(request(pg, a.me, { device }), "Too many attempts");
  // Another account isn't slowed by it.
  const n = await request(pg, other.me);
  // A minute gives one more.
  await pg.query(`update public.pane_rate set at = at - interval '61 seconds' where user_id = $1 and bucket = 'device-add'`, [a.me]);
  await request(pg, a.me, { device });
  await refused(request(pg, a.me, { device }), "Too many attempts");
  // Guessing codes: twenty lookups, then none until time passes.
  for (let i = 0; i < 20; i++) assertEquals((await app(pg, other.me, `select * from public.device_add_find($1)`, [hex(rand(32))])).length, 0);
  await refused(app(pg, other.me, `select * from public.device_add_find($1)`, [n.scan.answer]), "Too many attempts");
  await refused(app(pg, other.me, `select public.device_add_answer($1, $2, $3, $4)`, [n.id, n.scan.answer, "x", crypto.randomUUID()]), "Too many attempts");
  await pg.query(`update public.pane_rate set at = at - interval '31 seconds' where user_id = $1 and bucket = 'device-add-answer'`, [other.me]);
  assertEquals((await app(pg, other.me, `select * from public.device_add_find($1)`, [n.scan.answer])).length, 1);
  // The limiter itself isn't callable from an app session.
  await refused(app(pg, a.me, `select public.pane_device_take('device-add', 1000, 1000)`), "permission denied");
});

Deno.test("where the key is kept: devices list themselves with a tag, and removal carries one", async () => {
  const pg = await schemaDB();
  const a = await account(pg), other = await account(pg);
  const phone = crypto.randomUUID(), mac = crypto.randomUUID();
  type Device = { deviceId: string; platform: string; how: string; backedUp: boolean; name: string; epoch: string };
  const checkIn = async (who: typeof a, d: Device, keyId = who.keyId) =>
    await app(pg, who.me, `select public.key_device_check_in($1, $2, $3, $4, $5, $6, $7, $8)`,
      [d.deviceId, d.platform, await seal(d.name, await aesKey(who.dataKey), keyId, deviceContext(d.deviceId)), d.how, d.backedUp, keyId, d.epoch,
        await keyDeviceTag(who.dataKey, who.me, d)]);
  const iphone = { deviceId: phone, platform: "ios", how: "made", backedUp: true, name: "iPhone", epoch: hex(rand(16)) };
  const macbook = { deviceId: mac, platform: "macos", how: "added", backedUp: false, name: "Sara’s MacBook Air", epoch: hex(rand(16)) };
  await checkIn(a, iphone);
  await checkIn(a, macbook);
  await checkIn(a, iphone);
  const rows = await app(pg, a.me, `select device_id, name_ct, how, backed_up, tag, removed_at from public.key_devices order by how desc`);
  assertEquals(rows.map((r: any) => [r.device_id, r.how, r.backed_up, r.removed_at]), [[phone, "made", true, null], [mac, "added", false, null]]);
  assertEquals(rows[1].tag, await keyDeviceTag(a.dataKey, a.me, macbook));
  // The name is sealed with the account's key: the server's row doesn't say it.
  assert(!JSON.stringify(rows).includes("MacBook"));
  assertEquals(await open(rows[1].name_ct, await aesKey(a.dataKey), deviceContext(mac)), "Sara’s MacBook Air");
  await refused(app(pg, a.me, `select public.key_device_check_in($1, 'macos', 'Sara’s MacBook Air', 'added', false, $2, $3, $4)`, [mac, a.keyId, hex(rand(16)), hex(rand(32))]), "key_devices_name_sealed");
  // A device that had the key before it first listed itself doesn't say where it came from.
  const older = { deviceId: crypto.randomUUID(), platform: "ios", how: "unknown", backedUp: true, name: "iPhone", epoch: hex(rand(16)) };
  await checkIn(a, older);
  await refused(checkIn(a, { ...older, how: "guessed" }), "key_devices_how_check");
  await app(pg, a.me, `select public.forget_key_device($1)`, [older.deviceId]);
  // Nobody else sees the list, and nobody writes it directly.
  assertEquals((await app(pg, other.me, `select * from public.key_devices`)).length, 0);
  await refused(app(pg, a.me, `insert into public.key_devices (user_id, device_id, platform, name_ct, how, backed_up, key_id, epoch, tag) values ($1, $2, 'ios', $5, 'made', true, $3, repeat('0', 32), $4)`,
    [a.me, crypto.randomUUID(), a.keyId, hex(rand(32)), box(a.keyId)]), "permission denied");
  await refused(app(pg, a.me, `update public.key_devices set removed_at = now()`), "permission denied");
  // A device can't list itself under a key that isn't the account's.
  await refused(checkIn(a, { ...iphone, deviceId: crypto.randomUUID() }, hex(rand(8))), "isn't this account's");
  // Remove the Mac from the iPhone: the row carries the removal tag the Mac checks with its own key.
  const tag = await keyDeviceRemovalTag(a.dataKey, a.me, mac, macbook.epoch);
  assertEquals((await app(pg, other.me, `select public.remove_key_device($1, $2) as r`, [mac, tag]))[0].r, false);
  assertEquals((await app(pg, a.me, `select public.remove_key_device($1, $2) as r`, [mac, tag]))[0].r, true);
  const [removed] = await app(pg, a.me, `select removed_at, removal_tag from public.key_devices where device_id = $1`, [mac]);
  assert(removed.removed_at);
  assertEquals(removed.removal_tag, tag);
  // A removal written without the key (a made-up tag) is replaced by a real one, not kept in its way.
  await app(pg, a.me, `select public.remove_key_device($1, $2)`, [phone, hex(rand(32))]);
  await app(pg, a.me, `select public.remove_key_device($1, $2)`, [phone, await keyDeviceRemovalTag(a.dataKey, a.me, phone, iphone.epoch)]);
  assertEquals((await app(pg, a.me, `select removal_tag from public.key_devices where device_id = $1`, [phone]))[0].removal_tag, await keyDeviceRemovalTag(a.dataKey, a.me, phone, iphone.epoch));
  // The iPhone keeps its key in iCloud Keychain, so it doesn't obey: it checks in again, which clears the removal.
  await checkIn(a, iphone);
  assertEquals((await app(pg, a.me, `select removed_at from public.key_devices where device_id = $1`, [phone]))[0].removed_at, null);
  // The Mac drops its key and its row goes.
  await app(pg, a.me, `select public.forget_key_device($1)`, [mac]);
  assertEquals((await app(pg, a.me, `select device_id from public.key_devices`)).map((r: any) => r.device_id), [phone]);
  // Added again later, it's a new entry without the removal, under a new epoch: the old removal tag,
  // replayed by a session that read it, lands on the row but is not the tag for this epoch.
  const again = { ...macbook, epoch: hex(rand(16)) };
  await checkIn(a, again);
  const [fresh] = await app(pg, a.me, `select removed_at, epoch from public.key_devices where device_id = $1`, [mac]);
  assertEquals([fresh.removed_at, fresh.epoch], [null, again.epoch]);
  await app(pg, a.me, `select public.remove_key_device($1, $2)`, [mac, tag]);
  assert((await app(pg, a.me, `select removal_tag from public.key_devices where device_id = $1`, [mac]))[0].removal_tag !== await keyDeviceRemovalTag(a.dataKey, a.me, mac, again.epoch));
  // The account starts fresh: rows for the old key go when the first device checks in with the new one.
  await pg.query(`delete from public.account_keys where user_id = $1`, [a.me]);
  const k2 = hex(rand(8));
  await app(pg, a.me, `select * from public.create_account_key($1, $2, $3, 0)`, [k2, hex(rand(32)), box(k2)]);
  await checkIn(a, iphone, k2);
  assertEquals((await app(pg, a.me, `select device_id, key_id from public.key_devices`)), [{ device_id: phone, key_id: k2 }]);
});
