// account-status against the LOCAL database (scripts/account-status-e2e.sh runs the function
// on :8000 against the local stack). Creates throwaway users in SQL and removes them.
import { assert, assertEquals } from "jsr:@std/assert@1";
import postgres from "npm:postgres@3.4.5";

const URL_ = Deno.env.get("STATUS_URL") ?? "http://127.0.0.1:8000";
const db = postgres(Deno.env.get("PANE_DB")!, { max: 1, prepare: false });
const tag = crypto.randomUUID().slice(0, 8);
const withPassword = `status-pw-${tag}@example.com`;
const appleOnly = `status-apple-${tag}@example.com`;

const ask = (email: unknown, ip = `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`) =>
  fetch(URL_, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ email }) });

Deno.test({ name: "account-status end to end", sanitizeResources: false, sanitizeOps: false, fn: async (t) => {
  await db`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
           values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${withPassword}, crypt('correct horse battery', gen_salt('bf')), now(), now()),
                  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${appleOnly}, '', now(), now())`;
  try {
    await t.step("an account with a password", async () => {
      const r = await ask(withPassword.toUpperCase());
      assertEquals(r.status, 200);
      assertEquals(await r.json(), { exists: true, password: true });
    });
    await t.step("a Sign in with Apple account has no password", async () => {
      const r = await ask(appleOnly);
      assertEquals(await r.json(), { exists: true, password: false });
    });
    await t.step("an unknown address", async () => {
      const r = await ask(`nobody-${tag}@example.com`);
      assertEquals(await r.json(), { exists: false, password: false });
    });
    await t.step("a bad address is refused", async () => {
      const r = await ask("not-an-email");
      assertEquals(r.status, 400);
      await r.body?.cancel();
    });
    await t.step("hits and misses take the same minimum time", async () => {
      const t0 = performance.now(); await (await ask(`nobody2-${tag}@example.com`)).body?.cancel();
      const miss = performance.now() - t0;
      const t1 = performance.now(); await (await ask(withPassword)).body?.cancel();
      const hit = performance.now() - t1;
      assert(miss >= 330 && hit >= 330, `miss ${miss} hit ${hit}`);
    });
    await t.step("one IP is limited to 10 checks a minute", async () => {
      const ip = `10.9.${Math.floor(Math.random() * 250)}.1`;
      const codes: number[] = [];
      for (let i = 0; i < 11; i++) { const r = await ask(`limit-${i}-${tag}@example.com`, ip); codes.push(r.status); await r.body?.cancel(); }
      assertEquals(codes.filter((c) => c === 200).length, 10);
      assertEquals(codes.at(-1), 429);
    });
  } finally {
    await db`delete from auth.users where email in (${withPassword}, ${appleOnly})`;
    await db.end();
  }
} });
