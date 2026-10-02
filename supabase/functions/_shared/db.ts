// How the Edge Functions reach Postgres.
//
// Each function isolate has its own postgres.js pool, and a burst of requests starts many isolates.
// Straight to Postgres (SUPABASE_DB_URL, port 5432) every isolate holds real connections, idle ones
// included, and the database has 60: on 2 October 2026 about forty requests in a row used them up
// and every database call answered 53300 ("remaining connection slots are reserved") for the
// functions and for everyone else. So the functions go through Supabase's transaction pooler
// (port 6543), which shares a few real connections among any number of isolates and makes a busy
// moment a short wait instead of an error.
//
// The pooler's host isn't in the function's environment, so it's a secret:
//   supabase secrets set DB_POOLER_HOST=aws-1-eu-central-1.pooler.supabase.com --project-ref <ref>
// (Project Settings > Database > Connection pooling shows it.) The user, password and database come
// from SUPABASE_DB_URL. Without the secret (a local stack, a self-hosted one) the functions connect
// directly, one connection per isolate, let go after a few idle seconds.
//
// Transaction mode gives each transaction, or each statement outside one, whatever connection is
// free. Nothing here keeps state on a connection between them: settings are set_config(..., true)
// and locks are pg_advisory_xact_lock, inside sql.begin. Prepared statements are off for the same reason.
import postgres from "npm:postgres@3.4.5";
import { log } from "./log.ts";

export type Env = { get(name: string): string | undefined };
export type Target = { url: string; pooled: boolean; options: { max: number; idle_timeout: number; connect_timeout: number; prepare: false } };

/// The project's ref: the first label of SUPABASE_URL's host, or of a db.<ref>.supabase.co host.
function projectRef(supabaseURL: string | undefined, dbHost: string): string | null {
  const fromURL = /^https:\/\/([a-z0-9]{20})\.supabase\.(co|in)\b/.exec(supabaseURL ?? "")?.[1];
  return fromURL ?? /^db\.([a-z0-9]{20})\.supabase\.(co|in)$/.exec(dbHost)?.[1] ?? null;
}

/// Where to connect and with what pool: the transaction pooler when DB_POOLER_HOST names it and the
/// project's ref is known, otherwise SUPABASE_DB_URL as it is. `max` is what the function wants
/// when pooled; direct is always one connection.
export function target(env: Env, max = 3): Target {
  const direct = env.get("SUPABASE_DB_URL");
  if (!direct) throw new Error("SUPABASE_DB_URL is not set");
  const host = (env.get("DB_POOLER_HOST") ?? "").trim().toLowerCase();
  const one: Target = { url: direct, pooled: false, options: { max: 1, idle_timeout: 5, connect_timeout: 10, prepare: false } };
  if (!host) return one;
  // Only a pooler host: never a way to point the functions at some other server by typo.
  if (!/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)) return one;
  let u: URL;
  try { u = new URL(direct); } catch { return one; }
  const ref = projectRef(env.get("SUPABASE_URL"), u.hostname);
  if (!ref) return one;
  u.hostname = host;
  u.port = "6543";
  u.username = `${decodeURIComponent(u.username).split(".")[0] || "postgres"}.${ref}`;
  return { url: u.toString(), pooled: true, options: { max, idle_timeout: 20, connect_timeout: 10, prepare: false } };
}

/// The function's pool. Says once, in the log, which way it connects (never the address).
export function connect(env: Env = Deno.env, max = 3) {
  const t = target(env, max);
  log("db", { mode: t.pooled ? "pooled" : "direct", max: t.options.max });
  return postgres(t.url, t.options);
}

/// Postgres or the network refusing a new connection: nothing ran, so trying again is safe.
/// 53300 too_many_connections, 53400 configuration_limit_exceeded, 57P03 cannot_connect_now,
/// 08xxx connection exceptions, and postgres.js's own connection errors.
export function isConnectionError(e: unknown): boolean {
  const code = String((e as { code?: unknown } | null)?.code ?? "");
  return code === "53300" || code === "53400" || code === "57P03" || code.startsWith("08")
    || ["CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"].includes(code);
}

type Ping = (strings: TemplateStringsArray, ...values: never[]) => PromiseLike<unknown>;

/// Makes sure this isolate has a connection before a request's own queries run: one cheap query,
/// tried again a few times, a moment apart, when the database refuses the connection. After that
/// the request's queries use the connection this opened. Skipped while the pool was used within the
/// last few seconds. Never throws: a database that stays unreachable fails the request's own query,
/// which each function already answers.
export function readiness(sql: Ping, { freshMs = 4000, waits = [150, 400, 900], sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)) }: { freshMs?: number; waits?: number[]; sleep?: (ms: number) => Promise<unknown> } = {}) {
  let lastOk = 0;
  return async function ready(now: () => number = Date.now): Promise<boolean> {
    if (now() - lastOk < freshMs) return true;
    for (let attempt = 0; ; attempt++) {
      try {
        await sql`select 1`;
        lastOk = now();
        if (attempt > 0) log("db_retry", { attempts: attempt + 1, ok: true });
        return true;
      } catch (e) {
        if (!isConnectionError(e) || attempt >= waits.length) {
          log("db_retry", { attempts: attempt + 1, ok: false, code: String((e as { code?: unknown } | null)?.code ?? "") });
          return false;
        }
        await sleep(waits[attempt]);
      }
    }
  };
}
