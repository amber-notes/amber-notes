// What a burst of requests does to the database's connections, without the Edge runtime:
//   deno run -A scripts/db-burst.ts <postgres url | -> <before|after> [isolates=40]
// Each "isolate" is its own postgres.js pool, as each function isolate has, and is left open the way
// an isolate that just answered a request is. One after another, each runs what a small request
// runs (two queries). "before" is the pool the functions had (max 3, idle 20 s, no retry); "after"
// is _shared/db.ts's (the readiness check first, then the same queries).
// Prints how many requests got an answer and how many were refused a connection (53300).
// Meant for a throwaway database: see docs/Evidence/db-connections.md for the commands.
import postgres from "npm:postgres@3.4.5";
import { isConnectionError, readiness } from "../supabase/functions/_shared/db.ts";

const [where, mode = "after", count = "40"] = Deno.args;
// "-" takes the address from DB_BURST_URL, so a password never sits in the command line.
const url = where === "-" ? Deno.env.get("DB_BURST_URL") ?? "" : where;
if (!url || !["before", "after"].includes(mode)) { console.error("usage: db-burst.ts <postgres url> <before|after> [isolates]"); Deno.exit(2); }
const pooled = new URL(url).port === "6543" || Deno.env.get("POOLED") === "1";
const options = mode === "before"
  ? { max: 3, idle_timeout: 20, prepare: false as const }
  : { max: pooled ? 3 : 1, idle_timeout: pooled ? 20 : 5, connect_timeout: 10, prepare: false as const };
const isolates: ReturnType<typeof postgres>[] = [];
let ok = 0, refused = 0, other = 0, backends = 0;
const started = Date.now();
for (let i = 0; i < Number(count); i++) {
  const sql = postgres(url, { ...options, onnotice: () => {} });
  isolates.push(sql);
  try {
    if (mode === "after") await readiness(sql as never)();
    await sql`select 1`;
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from pg_stat_activity where backend_type = 'client backend'`;
    backends = Math.max(backends, n);
    ok++;
  } catch (e) {
    if (isConnectionError(e)) refused++; else { other++; console.error(String((e as Error).message).slice(0, 120)); }
  }
}
console.log(JSON.stringify({ mode, pooled, isolates: Number(count), answered: ok, refused, other, most_backends_seen: backends, ms: Date.now() - started }));
await Promise.all(isolates.map((s) => s.end({ timeout: 1 })));
