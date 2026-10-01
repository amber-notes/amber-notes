// The website's Mac download counter (20261001150000_download_counts.sql) on the whole schema in PGlite.
//   cd supabase/functions/mcp && deno test -A download_counts.pglite.test.ts
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { asUser, newUser, schemaDB } from "./pglite.ts";

/** Runs `sql` as a role with no sign-in, like the website's anon key through PostgREST. */
async function as<T = Record<string, unknown>>(pg: PGlite, role: "anon" | "service_role", sql: string, params: unknown[] = []) {
  return await pg.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    return (await tx.query<T>(sql, params)).rows;
  });
}

/** schemaDB, with service_role skipping row level security as it does on Supabase. */
async function db(): Promise<PGlite> {
  const pg = await schemaDB();
  await pg.exec(`alter role service_role bypassrls`);
  return pg;
}

const totals = async (pg: PGlite) =>
  (await as<any>(pg, "service_role", `select product, downloads::int, total::int from public.site_downloads_daily`))
    .map((r) => [r.product, r.downloads, r.total]);

Deno.test("anon adds one to today's total for each call, one row per day and product", async () => {
  const pg = await db();
  for (let i = 0; i < 3; i++) await as(pg, "anon", `select public.count_download('mac')`);
  assertEquals(await totals(pg), [["mac", 3, 3]]);
  const [row] = (await pg.query<any>(`select day = (now() at time zone 'utc')::date as today from public.site_downloads`)).rows;
  assertEquals(row.today, true);
});

Deno.test("the view gives daily totals, newest first, with a running total", async () => {
  const pg = await db();
  await pg.exec(`insert into public.site_downloads (day, product, downloads) values ('2026-10-01', 'mac', 4), ('2026-10-02', 'mac', 2)`);
  assertEquals((await as<any>(pg, "service_role", `select day::text, downloads::int, total::int from public.site_downloads_daily`)),
    [{ day: "2026-10-02", downloads: 2, total: 6 }, { day: "2026-10-01", downloads: 4, total: 4 }]);
});

Deno.test("only known products are counted", async () => {
  const pg = await db();
  await assertRejects(() => as(pg, "anon", `select public.count_download('windows')`));
  await assertRejects(() => as(pg, "anon", `select public.count_download(null)`));
  assertEquals(await totals(pg), []);
});

Deno.test("anon and signed-in accounts can't read or change the counts except by adding one", async () => {
  const pg = await db();
  await as(pg, "anon", `select public.count_download('mac')`);
  const me = await newUser(pg);
  const run = (sql: string) => [() => as(pg, "anon", sql), () => asUser(pg, me, sql)];
  for (const sql of [
    `select * from public.site_downloads`,
    `select * from public.site_downloads_daily`,
    `insert into public.site_downloads (product, downloads) values ('mac', 1000)`,
    `update public.site_downloads set downloads = 1000`,
    `delete from public.site_downloads`,
  ]) {
    for (const attempt of run(sql)) await assertRejects(attempt, Error, "permission denied", sql);
  }
  await assertRejects(() => asUser(pg, me, `select public.count_download('mac')`), Error, "permission denied");
  assertEquals(await totals(pg), [["mac", 1, 1]]);
});

Deno.test("the service key reads the counts but can't change them directly", async () => {
  const pg = await db();
  await as(pg, "service_role", `select public.count_download('mac')`);
  assertEquals(await totals(pg), [["mac", 1, 1]]);
  await assertRejects(() => as(pg, "service_role", `update public.site_downloads set downloads = 1000`), Error, "permission denied");
});

Deno.test("the table holds a date, a product and a number, nothing about a person", async () => {
  const pg = await db();
  const cols = (await pg.query<any>(
    `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'site_downloads' order by ordinal_position`)).rows;
  assertEquals(cols.map((c) => c.column_name), ["day", "product", "downloads"]);
  const fn = (await pg.query<any>(`select prosecdef, pg_get_function_result(oid) as result from pg_proc where proname = 'count_download'`)).rows[0];
  assertEquals([fn.prosecdef, fn.result], [true, "void"]);
});
