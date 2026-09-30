// Network addresses are only ever kept as keyed hashes, and the key changes every day: a stored
// hash can't be turned back into an address (the IPv4 space is small enough to try every one
// against a plain SHA-256), and hashes from different days can't be linked to each other.

const enc = new TextEncoder();

/** The UTC day, e.g. "2026-09-30": the period the key rotates on. */
export const today = (now = new Date()) => now.toISOString().slice(0, 10);

/** Hex HMAC-SHA256 of `value` under `secret` and the day. */
export async function dailyHash(secret: string, value: string, now = new Date()): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${today(now)}|${value}`)));
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Without either (tests, a misconfigured function) a random key for this instance: counts are then
// per instance, but a hash is never made with a key anyone could guess.
const fallback = crypto.randomUUID();

/** The functions' own secret: the service key is set in every Edge Function and never leaves the server. */
export const hashSecret = () => Deno.env.get("RATE_HASH_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || fallback;
