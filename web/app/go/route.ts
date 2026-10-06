// A link in an onboarding email, when click counting is on (LIFECYCLE_TRACK_CLICKS): tells the
// lifecycle function which email and which link (it checks the token and keeps the link's host and
// path, nothing else), then sends the reader on. Never waits long on the count, and never goes
// anywhere but the few places these emails link to.
import { goTarget } from "@/lib/go";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const to = goTarget(url.searchParams.get("to"));
  const s = url.searchParams.get("s"), t = url.searchParams.get("t");
  const base = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  if (to && s && t && base) {
    try {
      const res = await fetch(`${base}/functions/v1/lifecycle/click?${new URLSearchParams({ s, to, t })}`, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(1500) });
      await res.body?.cancel();
    } catch {
      // The count is lost; the reader still gets where they were going.
    }
  }
  return new Response(null, { status: 302, headers: { location: to ?? "/", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
