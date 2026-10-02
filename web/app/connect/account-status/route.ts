import { functionRegion } from "@/lib/mcp-proxy";

// The connect page's email-first sign-in asks here whether an email has an account. The answer is
// the account-status function's, as the app gets it, and nothing more: { exists, password }. The
// page can't call the function itself (it answers no CORS preflight), so this asks it from the
// server, with the visitor's address under the proxy secret, so the function's limits (per address
// and per email) count the visitor and not the site.
export const dynamic = "force-dynamic";

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: Request): Promise<Response> {
  // Only the connect page asks: same origin.
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  let sameOrigin = false;
  try { sameOrigin = Boolean(origin && host && new URL(origin).host === host); } catch { /* not a URL */ }
  if (!sameOrigin) return reply({ error: "not allowed" }, 403);
  const base = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_ANON_KEY ?? "";
  if (!base || !key) return reply({ error: "unavailable" }, 503);
  const body = await req.json().catch(() => null) as { email?: unknown } | null;
  if (typeof body?.email !== "string" || body.email.length > 320) return reply({ error: "bad email" }, 400);
  const headers: Record<string, string> = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
  const secret = process.env.MCP_PROXY_SECRET;
  // Vercel sets these itself and drops what a client sent.
  const ip = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim();
  if (secret && ip) Object.assign(headers, { "x-mcp-client-ip": ip, "x-mcp-proxy-secret": secret });
  const region = functionRegion(process.env.FUNCTION_REGION);
  if (region) headers["x-region"] = region;
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/functions/v1/account-status`, {
      method: "POST", headers, body: JSON.stringify({ email: body.email }), cache: "no-store", signal: AbortSignal.timeout(8000),
    });
    const answer = await res.json().catch(() => null) as { exists?: unknown; password?: unknown } | null;
    if (res.ok && typeof answer?.exists === "boolean" && typeof answer.password === "boolean") {
      return reply({ exists: answer.exists, password: answer.password });
    }
    return res.status === 429 ? reply({ error: "slow down" }, 429) : reply({ error: "unavailable" }, 502);
  } catch {
    return reply({ error: "unavailable" }, 502);
  }
}
