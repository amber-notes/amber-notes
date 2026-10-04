// "Send a link" on /reset-password: asks Supabase Auth to email a reset link (POST /auth/v1/recover).
// Asked from the server so the answer can be the same for every email: Supabase answers an unknown
// address with 200, but a known one can come back 429 (one email a minute per address, and the
// project's hourly cap) or 500 (the mail didn't go), which would say the account exists. So every
// answer from Supabase becomes { sent: true }; only a request that never reached it is an error.
// No redirect and no PKCE challenge: the email's link is the template's own
// (supabase/templates/recovery.html) and works in any browser.
//
// Limits are Supabase's: per address (smtp_max_frequency) and per project per hour
// (rate_limit_email_sent). One here would add nothing, since the public key can call /recover directly.
export const dynamic = "force-dynamic";

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: Request): Promise<Response> {
  // Only the reset page asks: same origin.
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  let sameOrigin = false;
  try { sameOrigin = Boolean(origin && host && new URL(origin).host === host); } catch { /* not a URL */ }
  if (!sameOrigin) return reply({ error: "not allowed" }, 403);
  const base = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_ANON_KEY ?? "";
  if (!base || !key) return reply({ error: "unavailable" }, 503);
  const body = await req.json().catch(() => null) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: "bad email" }, 400);
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/auth/v1/recover`, {
      method: "POST",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ email }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    // The status only, never the address.
    if (!res.ok) console.warn(`/reset-password/request: auth answered ${res.status}`);
    return reply({ sent: true });
  } catch {
    return reply({ error: "unavailable" }, 502);
  }
}
