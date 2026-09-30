// deno test --allow-read --allow-run scripts/e2ee-tool.test.ts
import { assert, assertEquals, assertNotEquals, assertRejects } from "jsr:@std/assert@1";
import { fromBase64, hex, keyIdOf, tokenKey, unwrap, Vault } from "../supabase/functions/_shared/e2ee.ts";
import { previewOf, titleOf } from "../supabase/functions/mcp/notes.ts";
import { handle, headOf } from "./e2ee-tool.ts";

const USER = "2b7c1e0a-4f3d-4e21-9a8b-0c1d2e3f4a5b";
const NOTE = "7d1e2f3a-4b5c-4d6e-8f70-812233445566";
const BODY = "# Lisbon in May\n\nFour days of **tiles**, trams and pastries.\n\n- [ ] Tram 28 early\n- [x] Book flights\n\n| Place | Dish |\n| --- | --- |\n| Manteigaria | Pastel de nata |\n";

Deno.test("a new key opens again from its recovery key, and only for its account", async () => {
  const k = await handle({ op: "new-key", user: USER }) as Record<string, string>;
  assertEquals(k.key_id, await keyIdOf(fromBase64(k.dk)));
  assertEquals(k.recovery_key_text.length, 34);
  assert(k.recovery_wrap.startsWith(`amb2.${k.key_id}.`));
  assert(/^[0-9a-f]{64}$/.test(k.verifier));

  // The recovery key reads back however it's typed.
  const opened = await handle({ op: "open-key", user: USER, recovery_key_text: k.recovery_key_text.toLowerCase().replaceAll("-", " "), recovery_wrap: k.recovery_wrap, verifier: k.verifier });
  assertEquals(opened, { dk: k.dk, key_id: k.key_id });

  const other = await handle({ op: "new-key", user: USER }) as Record<string, string>;
  await assertRejects(() => handle({ op: "open-key", user: USER, recovery_key_text: other.recovery_key_text, recovery_wrap: k.recovery_wrap, verifier: k.verifier }));
  await assertRejects(() => handle({ op: "open-key", user: "00000000-0000-4000-8000-000000000000", recovery_key_text: k.recovery_key_text, recovery_wrap: k.recovery_wrap, verifier: k.verifier }));
  await assertRejects(() => handle({ op: "open-key", user: USER, recovery_key_text: k.recovery_key_text, recovery_wrap: k.recovery_wrap, verifier: other.verifier }));
  await assertRejects(() => handle({ op: "open-key", user: USER, recovery_key_text: "not a key", recovery_wrap: k.recovery_wrap, verifier: k.verifier }));
});

Deno.test("a sealed note opens again, with the head the MCP server would write", async () => {
  const { dk, key_id } = await handle({ op: "new-key", user: USER }) as Record<string, string>;
  const sealed = await handle({ op: "seal-note", dk, user: USER, id: NOTE, body: BODY }) as { body_ct: string; head_ct: string };
  assert(sealed.body_ct.startsWith(`amb2.${key_id}.`) && sealed.head_ct.startsWith(`amb2.${key_id}.`));
  const head = { title: titleOf(BODY), preview: previewOf(BODY) };
  assertEquals(head.title, "Lisbon in May");
  assertEquals(await handle({ op: "open-note", dk, user: USER, id: NOTE, head_ct: sealed.head_ct, body_ct: sealed.body_ct }), { head, body: BODY });

  // The app and the server read it with the shared Vault.
  const v = await Vault.from(fromBase64(dk), USER);
  assertEquals(await v.openHead(NOTE, sealed.head_ct), head);
  assertEquals(await v.openBody(NOTE, sealed.body_ct), BODY);
  // A box is bound to its note: another id doesn't open it.
  await assertRejects(() => handle({ op: "open-note", dk, user: USER, id: "00000000-0000-4000-8000-000000000000", head_ct: sealed.head_ct }));

  assertEquals(await handle({ op: "head", body: BODY }), head);
  assertEquals(headOf("\n\nGroceries\n- [ ] Oat milk\n- [ ] Eggs"), { title: "Groceries", preview: "Oat milk · Eggs" });
  assertEquals(headOf(""), { title: "New Note", preview: "" });
  const locked = await handle({ op: "seal-note", dk, user: USER, id: NOTE, body: BODY, locked: true }) as { body_ct: null; head_ct: string };
  assertEquals(locked.body_ct, null);
  assertEquals(await handle({ op: "open-note", dk, user: USER, id: NOTE, head_ct: locked.head_ct }), { head: { title: "Lisbon in May" } });
});

Deno.test("a folder name round trips", async () => {
  const { dk } = await handle({ op: "new-key", user: USER }) as Record<string, string>;
  const { name_ct } = await handle({ op: "seal-folder", dk, user: USER, id: NOTE, name: "Travel" }) as { name_ct: string };
  assertEquals(await handle({ op: "open-folder", dk, user: USER, id: NOTE, name_ct }), { name: "Travel" });
  await assertRejects(() => handle({ op: "open-note", dk, user: USER, id: NOTE, head_ct: name_ct }), "a folder box isn't a head");
});

Deno.test("the connect code is what the server's /token opens", async () => {
  const { dk } = await handle({ op: "new-key", user: USER }) as Record<string, string>;
  const c = await handle({ op: "connect-code", dk, user: USER }) as Record<string, string>;
  assert(/^amb_code_[0-9a-f]{64}$/.test(c.code));
  assertEquals(c.code_hash, hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(c.code)))));
  // The shape /connect/decide accepts.
  assert(/^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$/.test(c.code_wrap) && c.code_wrap.length <= 300);
  assertEquals(await unwrap(c.code_wrap, await tokenKey(c.code, "code"), "code", USER), fromBase64(dk));
  const again = await handle({ op: "connect-code", dk, user: USER }) as Record<string, string>;
  assertNotEquals(again.code, c.code);
});

Deno.test("bad requests are refused without echoing them", async () => {
  await assertRejects(() => handle({ op: "nope" }), Error, "unknown op");
  await assertRejects(() => handle({ op: "seal-note", dk: "AAAA", user: USER, id: NOTE, body: "x" }), Error, "dk must be 32 bytes");
  await assertRejects(() => handle({ op: "seal-folder", dk: "x", user: "not-a-uuid", id: NOTE, name: "x" }));
});

Deno.test("stdin to stdout, as review-account.py calls it", async () => {
  const run = async (input: string) => {
    const p = new Deno.Command(Deno.execPath(), {
      args: ["run", "--allow-read", new URL("./e2ee-tool.ts", import.meta.url).pathname], stdin: "piped", stdout: "piped", stderr: "piped",
    }).spawn();
    const w = p.stdin.getWriter();
    await w.write(new TextEncoder().encode(input));
    await w.close();
    const out = await p.output();
    return { code: out.code, body: JSON.parse(new TextDecoder().decode(out.stdout)) };
  };
  const ok = await run(JSON.stringify({ op: "new-key", user: USER }));
  assertEquals(ok.code, 0);
  assertEquals(Object.keys(ok.body).sort(), ["dk", "key_id", "recovery_key_text", "recovery_wrap", "verifier"]);
  const bad = await run(JSON.stringify({ op: "open-note", dk: ok.body.dk, user: USER, id: NOTE, head_ct: "amb2.0000000000000000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==" }));
  assertEquals(bad, { code: 1, body: { error: "couldn't open it (wrong key or data)" } });
  assertEquals((await run("not json")).body, { error: "stdin must be one JSON object" });
});
