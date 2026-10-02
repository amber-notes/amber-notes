import { assert, assertEquals } from "jsr:@std/assert@1";
import { connect, isConnectionError, readiness, target } from "./db.ts";

const env = (vars: Record<string, string>) => ({ get: (k: string) => vars[k] });
const REF = "abcdefghijklmnopqrst";
const DIRECT = `postgresql://postgres:p%40ss%2Fword@db.${REF}.supabase.co:5432/postgres`;

Deno.test("with the pooler's host, the functions connect through the transaction pooler as postgres.<ref>", () => {
  const t = target(env({ SUPABASE_DB_URL: DIRECT, SUPABASE_URL: `https://${REF}.supabase.co`, DB_POOLER_HOST: "aws-1-eu-central-1.pooler.supabase.com" }));
  const u = new URL(t.url);
  assertEquals([u.hostname, u.port, u.pathname], ["aws-1-eu-central-1.pooler.supabase.com", "6543", "/postgres"]);
  assertEquals(u.username, `postgres.${REF}`);
  // The password is the one in SUPABASE_DB_URL, still encoded.
  assertEquals(u.password, "p%40ss%2Fword");
  assertEquals([t.pooled, t.ssl], [true, false]);
  assertEquals(t.options, { max: 3, idle_timeout: 20, connect_timeout: 10, prepare: false });
  // The ref can come from the database host when SUPABASE_URL isn't a project address.
  assertEquals(target(env({ SUPABASE_DB_URL: DIRECT, SUPABASE_URL: "http://kong:8000", DB_POOLER_HOST: "aws-1-eu-central-1.pooler.supabase.com" })).pooled, true);
  assertEquals(target(env({ SUPABASE_DB_URL: DIRECT, DB_POOLER_HOST: "aws-0-us-east-1.pooler.supabase.com" }), 2).options.max, 2);
});

Deno.test("without it, or with anything that isn't a pooler host, one direct connection that lets go quickly", () => {
  const direct = { url: DIRECT, pooled: false, ssl: false, options: { max: 1, idle_timeout: 5, connect_timeout: 10, prepare: false as const } };
  assertEquals(target(env({ SUPABASE_DB_URL: DIRECT })), direct);
  assertEquals(target(env({ SUPABASE_DB_URL: DIRECT, DB_POOLER_HOST: "  " })), direct);
  for (const bad of ["evil.example", "db.example.com:6543", "x.pooler.supabase.com.evil.example", "https://aws-1-eu-central-1.pooler.supabase.com", "a b.pooler.supabase.com"]) {
    assertEquals(target(env({ SUPABASE_DB_URL: DIRECT, SUPABASE_URL: `https://${REF}.supabase.co`, DB_POOLER_HOST: bad })), direct, bad);
  }
  // A local stack: no project ref anywhere, so the pooler's user can't be made.
  const local = "postgresql://postgres:postgres@supabase_db_pane:5432/postgres";
  assertEquals(target(env({ SUPABASE_DB_URL: local, SUPABASE_URL: "http://kong:8000", DB_POOLER_HOST: "aws-1-eu-central-1.pooler.supabase.com" })).url, local);
});

Deno.test("it says whether the address asks for TLS, for the pooled address too, and never changes it", () => {
  const vars = { SUPABASE_URL: `https://${REF}.supabase.co`, DB_POOLER_HOST: "aws-1-eu-central-1.pooler.supabase.com" };
  for (const mode of ["require", "verify-ca", "verify-full"]) {
    const t = target(env({ ...vars, SUPABASE_DB_URL: `${DIRECT}?sslmode=${mode}` }));
    assertEquals([t.pooled, t.ssl, new URL(t.url).searchParams.get("sslmode")], [true, true, mode]);
  }
  for (const not of ["", "?sslmode=disable", "?sslmode=prefer", "?application_name=sslmode=require-ish"]) {
    assertEquals(target(env({ ...vars, SUPABASE_DB_URL: DIRECT + not })).ssl, false, not);
  }
  assertEquals(target(env({ SUPABASE_DB_URL: `${DIRECT}?sslmode=require` })).ssl, true);
});

Deno.test("the log says how the database is reached, in fields the log keeps", () => {
  const seen: string[] = [];
  const real = console.log;
  console.log = (s: string) => seen.push(s);
  try {
    connect(env({ SUPABASE_DB_URL: `${DIRECT}?sslmode=require`, SUPABASE_URL: `https://${REF}.supabase.co`, DB_POOLER_HOST: "aws-1-eu-central-1.pooler.supabase.com" }), 3).end({ timeout: 0 });
    connect(env({ SUPABASE_DB_URL: DIRECT }), 3).end({ timeout: 0 });
  } finally {
    console.log = real;
  }
  assertEquals(seen.map((s) => JSON.parse(s)), [
    { event: "db", mode: "pooled", count: 3, ssl: true },
    { event: "db", mode: "direct", count: 1, ssl: false },
  ]);
  // Never the address.
  assert(!seen.join("").includes("supabase.co") && !seen.join("").includes("pooler"));
});

Deno.test("a refused connection is told apart from a query that failed", () => {
  for (const code of ["53300", "53400", "57P03", "08006", "08001", "CONNECT_TIMEOUT", "CONNECTION_CLOSED", "ECONNRESET"]) assert(isConnectionError({ code }), code);
  // The pooler's own refusals arrive as XX000 with a message about clients or its pool.
  for (const message of ["Max client connections reached", "MaxClientsInSessionMode: max clients reached", "unable to check out connection from the pool", "connection to database not available"]) {
    assert(isConnectionError({ code: "XX000", message }), message);
  }
  for (const e of [{ code: "23505" }, { code: "42P01" }, { code: "40001" }, { code: "XX000", message: "cache lookup failed for relation 1234" }, { code: "28P01" }, new Error("boom"), null, undefined, "53300"]) assert(!isConnectionError(e), String(e));
});

Deno.test("a request waits out a full database instead of failing, and doesn't ask again while the pool is warm", async () => {
  let calls = 0, refuse = 2;
  const slept: number[] = [];
  const sql = (() => { calls++; return refuse-- > 0 ? Promise.reject({ code: "53300" }) : Promise.resolve([{ ok: 1 }]); }) as never;
  let clock = 1_000_000;
  const ready = readiness(sql, { sleep: (ms) => { slept.push(ms); return Promise.resolve(); } });
  const lines: string[] = [];
  const real = console.log;
  console.log = (l: string) => lines.push(l);
  try { assertEquals(await ready(() => clock), true); } finally { console.log = real; }
  assertEquals([calls, slept], [3, [150, 400]]);
  assertEquals(lines.map((l) => JSON.parse(l)), [{ event: "db_retry", status: "ok", attempts: 3 }]);
  // Used a moment ago: no extra query.
  clock += 3000;
  assertEquals(await ready(() => clock), true);
  assertEquals(calls, 3);
  // Idle long enough for the connection to have been let go: checked again.
  clock += 5000;
  assertEquals(await ready(() => clock), true);
  assertEquals(calls, 4);
});

Deno.test("it gives up after a few tries, and at once for anything that isn't a refused connection", async () => {
  let calls = 0;
  const slept: number[] = [];
  const full = (() => { calls++; return Promise.reject({ code: "53300" }); }) as never;
  assertEquals(await readiness(full, { sleep: (ms) => { slept.push(ms); return Promise.resolve(); } })(), false);
  assertEquals([calls, slept], [4, [150, 400, 900]]);
  calls = 0;
  const broken = (() => { calls++; return Promise.reject({ code: "42501" }); }) as never;
  assertEquals(await readiness(broken, { sleep: () => Promise.resolve() })(), false);
  assertEquals(calls, 1);
});
