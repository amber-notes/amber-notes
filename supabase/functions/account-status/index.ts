// Whether an email already has an Amber Notes account, for the email-first sign-in screen.
//
//   POST /functions/v1/account-status   { "email": "..." }
//   Authorization: Bearer <the app's anon key>          (verify_jwt stays on)
//   → 200 { "exists": boolean, "password": boolean }
//     exists:false                 → new here: the app offers "Create a password"
//     exists:true,  password:true  → the app asks for the password
//     exists:true,  password:false → a Sign in with Apple account: the app says to use Apple
//   → 400 bad email · 429 too many checks (the app falls back to a plain password field)
//
// Privacy: this tells whoever asks whether an address uses Amber Notes (the trade-off the
// email-first screen accepts). It never returns anything about the account beyond these two
// booleans, is rate-limited per IP (10 a minute, 30 an hour) and per address (20 an hour), keys
// the limiter by salted hashes, and pads every reply to the same minimum time.

import { connect, readiness } from "../_shared/db.ts";
import { atLeast, hashKey, normalizeEmail, RateLimiter, statusFrom } from "./logic.ts";
import { clientAddress } from "../_shared/client.ts";
import { logError } from "../_shared/log.ts";

// Through the transaction pooler when DB_POOLER_HOST is set (_shared/db.ts says why).
const sql = connect(Deno.env, 2);
const ready = readiness(sql);
const SALT = Deno.env.get("ACCOUNT_STATUS_SALT") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const perMinute = new RateLimiter(10, 60_000);
const perHour = new RateLimiter(30, 3_600_000);
const perEmail = new RateLimiter(20, 3_600_000);
const FLOOR_MS = 350;

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

Deno.serve((req) => atLeast(FLOOR_MS, async () => {
  if (req.method !== "POST") return reply({ error: "method not allowed" }, 405);
  await ready();
  const ip = clientAddress(req);
  const ipKey = await hashKey(SALT, ip);
  if (!perMinute.allow(ipKey) || !perHour.allow(ipKey)) return reply({ error: "slow down" }, 429);

  let email: string | null = null;
  try { email = normalizeEmail((await req.json())?.email); } catch { /* not JSON */ }
  if (!email) return reply({ error: "bad email" }, 400);
  if (!perEmail.allow(await hashKey(SALT, email))) return reply({ error: "slow down" }, 429);

  try {
    const [row] = await sql<{ exists: boolean; has_password: boolean }[]>`
      select true as exists,
             coalesce(u.encrypted_password, '') <> '' as has_password
      from auth.users u
      where lower(u.email) = ${email} and u.deleted_at is null
      order by (coalesce(u.encrypted_password, '') <> '') desc
      limit 1`;
    return reply(statusFrom(row));
  } catch (e) {
    logError("account-status", e);
    return reply({ error: "unavailable" }, 500);
  }
}));
