// The shared formats, checked against the vectors every side tests with (e2ee-vectors.json; the
// Swift side is PaneTests/E2EETests.swift). Regenerate the file only when a format changes on
// purpose: deno run -A supabase/functions/_shared/e2ee.test.ts --write
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  aesKey, bodyContext, canonicalRecoveryKey, fileMetaContext, folderContext, fromBase64, headContext, keyIdOf, open, OpenError,
  openFile, parseRecoveryKey, recoveryKEK, recoveryKeyText, seal, sealFile, tokenKey, toBase64, unwrap, Vault, verifierOf, wrap,
  type WrapPurpose,
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
  const recovery = bytes(0x30, 16);
  const recoveryText = await recoveryKeyText(recovery);
  const file = bytes(0, 300);
  const secrets: [WrapPurpose, string][] = [
    ["access", "amb_at_" + "ab".repeat(32)], ["refresh", "amb_rt_" + "12".repeat(32)],
    ["code", "amb_code_" + "cd".repeat(32)], ["pane", "pane_" + "ef".repeat(32)],
  ];
  const wraps: Record<string, string> = {};
  for (const [purpose, secret] of secrets) wraps[purpose] = await wrap(dataKey, await tokenKey(secret, purpose), purpose, userId, nonce);
  const head = '{"title":"Lisbon","preview":"Pastéis at 9 ✓"}';
  const lockedHead = '{"title":"Passwords"}';
  const meta = '{"name":"ticket.pdf","type":"com.adobe.pdf","size":300}';
  return {
    about: "Fixed inputs and the exact boxes they seal to. Every implementation must produce these with the given nonce, and open them.",
    data_key: toBase64(dataKey), key_id: keyId, verifier: await verifierOf(dataKey, userId),
    nonce: toBase64(nonce), user_id: userId, note_id: noteId,
    body: { text: "# Lisbon\nPastéis at 9 ✓", context: bodyContext(noteId), sealed: await seal("# Lisbon\nPastéis at 9 ✓", key, keyId, bodyContext(noteId), nonce) },
    head: { json: head, context: headContext(noteId), sealed: await seal(head, key, keyId, headContext(noteId), nonce) },
    locked_head: { json: lockedHead, context: headContext(noteId), sealed: await seal(lockedHead, key, keyId, headContext(noteId), nonce) },
    folder: { name: "Travel", context: folderContext(noteId), sealed: await seal("Travel", key, keyId, folderContext(noteId), nonce) },
    file_meta: { json: meta, context: fileMetaContext(noteId), sealed: await seal(meta, key, keyId, fileMetaContext(noteId), nonce) },
    file: { plain: toBase64(file), attachment_id: noteId, sealed: toBase64(await sealFile(file, key, keyId, noteId, nonce)) },
    recovery: {
      bytes: toBase64(recovery), text: recoveryText,
      // Typed back sloppily: lower case, spaces for dashes, O for 0, l and I for 1.
      typed: recoveryText.toLowerCase().replace(/-/g, " ").replace(/0/g, "O").replace(/1/g, "l"),
      canonical: recoveryText.replace(/-/g, ""),
      wrap: await wrap(dataKey, await recoveryKEK(recovery, userId), "recovery", userId, nonce),
    },
    tokens: { ...Object.fromEntries(secrets), wraps },
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
  const access = await unwrap(v.tokens.wraps.access, await tokenKey(v.tokens.access, "access"), "access", v.user_id);
  assertEquals(toBase64(access), v.data_key);
  // A token of one kind doesn't open another kind's wrap, nor another account's.
  await assertRejects(async () => unwrap(v.tokens.wraps.access, await tokenKey(v.tokens.access, "refresh"), "access", v.user_id), OpenError);
  await assertRejects(async () => unwrap(v.tokens.wraps.access, await tokenKey(v.tokens.access, "access"), "access", crypto.randomUUID()), OpenError);
});

Deno.test("the verifier names the key and the account", async () => {
  const v = JSON.parse(await Deno.readTextFile(path));
  const dk = fromBase64(v.data_key);
  assertEquals(await verifierOf(dk, v.user_id.toUpperCase()), v.verifier);
  assert(await verifierOf(dk, crypto.randomUUID()) !== v.verifier);
  assert(await verifierOf(new Uint8Array(32), v.user_id) !== v.verifier);
});

Deno.test("the recovery key reads back however it's typed, and a typo is caught", async () => {
  const v = JSON.parse(await Deno.readTextFile(path));
  assertEquals(v.recovery.text.length, 34);
  assertEquals(canonicalRecoveryKey(v.recovery.typed), v.recovery.canonical);
  const parsed = await parseRecoveryKey(v.recovery.typed);
  assertEquals(parsed && toBase64(parsed), v.recovery.bytes);
  assertEquals(toBase64(await unwrap(v.recovery.wrap, await recoveryKEK(parsed!, v.user_id), "recovery", v.user_id)), v.data_key);
  // One character changed: the check fails (any single change does, one time in 4096 it wouldn't).
  const c = v.recovery.canonical as string;
  const typo = c.slice(0, 5) + (c[5] === "7" ? "8" : "7") + c.slice(6);
  assertEquals(await parseRecoveryKey(typo), null);
  assertEquals(await parseRecoveryKey(c.slice(1)), null);
  assertEquals(canonicalRecoveryKey(c.slice(0, 27) + "U"), null);
  // Every key round-trips.
  for (let i = 0; i < 50; i++) {
    const k = crypto.getRandomValues(new Uint8Array(16));
    assertEquals(toBase64((await parseRecoveryKey(await recoveryKeyText(k)))!), toBase64(k));
  }
});

Deno.test("the vault seals notes that only open as themselves", async () => {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const vault = await Vault.from(raw, crypto.randomUUID());
  // The raw bytes are wiped once imported.
  assert(raw.every((b) => b === 0));
  const a = crypto.randomUUID(), b = crypto.randomUUID();
  const sealed = await vault.sealBody(a, "secret");
  assert(sealed.startsWith(`amb2.${vault.keyId}.`));
  assertEquals(await vault.openBody(a, sealed), "secret");
  await assertRejects(() => vault.openBody(b, sealed), OpenError);
  assertEquals(await vault.openHead(a, await vault.sealHead(a, { title: "T", preview: "P" })), { title: "T", preview: "P" });
  // A locked note's head holds its title and nothing else.
  assertEquals(await vault.openHead(a, await vault.sealHead(a, { title: "T" })), { title: "T" });
  // Random nonces: the same text never seals the same way twice.
  assert(sealed !== await vault.sealBody(a, "secret"));
});
