// The shared formats, checked against the vectors every side tests with (e2ee-vectors.json).
// Regenerate the file (only when a format changes on purpose): deno run -A e2ee.test.ts --write
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  aesKey, bodyContext, fileMetaContext, folderContext, fromBase64, headContext, keyIdOf, normalizeRecoveryKey, open, OpenError,
  openFile, passwordKey, recoveryKey, seal, sealFile, tokenKey, toBase64, unwrap, Vault, wrap, type WrapPurpose,
} from "./e2ee.ts";

const path = new URL("./e2ee-vectors.json", import.meta.url);
const bytes = (start: number, n: number) => Uint8Array.from({ length: n }, (_, i) => (start + i) & 0xff);

async function build() {
  const dataKey = bytes(1, 32);
  const nonce = bytes(0xa0, 12);
  const userId = "7c0f1d2e-3a4b-4c5d-8e6f-0a1b2c3d4e5f";
  const noteId = "11111111-2222-4333-8444-555555555555";
  const key = await aesKey(dataKey);
  const keyId = await keyIdOf(dataKey);
  const salt = toBase64(bytes(0x40, 16));
  const iterations = 1000;
  const password = "Blåbär sylt 2026";
  const recovery = "7K4P-Q2WM-9XRD-HT3C-LN8F-B6YJ-M2VA";
  const token = "amb_at_" + "ab".repeat(32);
  const file = bytes(0, 300);
  const wraps: Record<string, string> = {};
  for (const [purpose, secret] of [["access", token], ["code", "amb_code_" + "cd".repeat(32)], ["pane", "pane_" + "ef".repeat(32)]] as [WrapPurpose, string][]) {
    wraps[purpose] = await wrap(dataKey, await tokenKey(secret, purpose), purpose, userId, nonce);
  }
  return {
    about: "Fixed inputs and the exact boxes they seal to. Every implementation must produce these with the given nonce, and open them.",
    data_key: toBase64(dataKey), key_id: keyId, nonce: toBase64(nonce), user_id: userId, note_id: noteId,
    body: { text: "# Lisbon\nPastéis at 9 ✓", context: bodyContext(noteId), sealed: await seal("# Lisbon\nPastéis at 9 ✓", key, keyId, bodyContext(noteId), nonce) },
    head: { json: '{"title":"Lisbon","preview":"Pastéis at 9 ✓"}', context: headContext(noteId), sealed: await seal('{"title":"Lisbon","preview":"Pastéis at 9 ✓"}', key, keyId, headContext(noteId), nonce) },
    folder: { name: "Travel", context: folderContext(noteId), sealed: await seal("Travel", key, keyId, folderContext(noteId), nonce) },
    file_meta: { json: '{"name":"ticket.pdf","type":"com.adobe.pdf"}', context: fileMetaContext(noteId), sealed: await seal('{"name":"ticket.pdf","type":"com.adobe.pdf"}', key, keyId, fileMetaContext(noteId), nonce) },
    file: { plain: toBase64(file), attachment_id: noteId, sealed: toBase64(await sealFile(file, key, keyId, noteId, nonce)) },
    password: { password, salt, iterations, wrap: await wrap(dataKey, await passwordKey(password, salt, iterations), "password", userId, nonce) },
    recovery: { typed: recovery, normalized: normalizeRecoveryKey(recovery), wrap: await wrap(dataKey, await recoveryKey(recovery, userId), "recovery", userId, nonce) },
    tokens: { access: token, code: "amb_code_" + "cd".repeat(32), pane: "pane_" + "ef".repeat(32), wraps },
  };
}

if (Deno.args.includes("--write")) {
  await Deno.writeTextFile(path, JSON.stringify(await build(), null, 2) + "\n");
  console.log("wrote", path.pathname);
}

Deno.test("every format seals exactly to the shared vectors", async () => {
  const saved = JSON.parse(await Deno.readTextFile(path));
  assertEquals(await build(), saved);
});

Deno.test("the vectors open again, and the wrong context or key doesn't", async () => {
  const v = JSON.parse(await Deno.readTextFile(path));
  const key = await aesKey(fromBase64(v.data_key));
  assertEquals(await open(v.body.sealed, key, v.body.context), v.body.text);
  await assertRejects(() => open(v.body.sealed, key, headContext(v.note_id)), OpenError);
  await assertRejects(async () => open(v.body.sealed, await aesKey(new Uint8Array(32)), v.body.context), OpenError);
  assertEquals(toBase64(await openFile(fromBase64(v.file.sealed), key, v.file.attachment_id)), v.file.plain);
  await assertRejects(() => openFile(fromBase64(v.file.sealed), key, crypto.randomUUID()), OpenError);
  const dk = await unwrap(v.password.wrap, await passwordKey(v.password.password, v.password.salt, v.password.iterations), "password", v.user_id);
  assertEquals(toBase64(dk), v.data_key);
  await assertRejects(async () => unwrap(v.password.wrap, await passwordKey("wrong", v.password.salt, v.password.iterations), "password", v.user_id), OpenError);
  assertEquals(toBase64(await unwrap(v.recovery.wrap, await recoveryKey(v.recovery.normalized.toLowerCase(), v.user_id), "recovery", v.user_id)), v.data_key);
  const access = await unwrap(v.tokens.wraps.access, await tokenKey(v.tokens.access, "access"), "access", v.user_id);
  assertEquals(toBase64(access), v.data_key);
  // A token of one kind doesn't open another kind's wrap, nor another account's.
  await assertRejects(async () => unwrap(v.tokens.wraps.access, await tokenKey(v.tokens.access, "refresh"), "access", v.user_id), OpenError);
  await assertRejects(async () => unwrap(v.tokens.wraps.access, await tokenKey(v.tokens.access, "access"), "access", crypto.randomUUID()), OpenError);
});

Deno.test("the vault seals notes that only open as themselves", async () => {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const vault = await Vault.from(raw, crypto.randomUUID());
  const a = crypto.randomUUID(), b = crypto.randomUUID();
  const sealed = await vault.sealBody(a, "secret");
  assert(sealed.startsWith(`amb2.${vault.keyId}.`));
  assertEquals(await vault.openBody(a, sealed), "secret");
  await assertRejects(() => vault.openBody(b, sealed), OpenError);
  assertEquals(await vault.openHead(a, await vault.sealHead(a, { title: "T", preview: "P" })), { title: "T", preview: "P" });
  // Random nonces: the same text never seals the same way twice.
  assert(sealed !== await vault.sealBody(a, "secret"));
});
