import { isOneClick, readUnsubscribeLink } from "@/lib/unsubscribe";

// Stops the onboarding emails for one account. Two callers:
//   * the button on /unsubscribe (a form post): answered with a redirect back to the page;
//   * a mail app's own unsubscribe button, from the List-Unsubscribe header (RFC 8058): it posts
//     "List-Unsubscribe=One-Click" and gets a plain 200.
// The lifecycle function checks the link's HMAC and records the stop. Only POST does anything:
// a GET (a mail scanner, a prefetch) changes nothing.
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const link = readUnsubscribeLink(url.searchParams.get("u"), url.searchParams.get("t"));
  const oneClick = isOneClick(await req.text().catch(() => ""));
  const back = (q: string) => new Response(null, { status: 303, headers: { location: `/unsubscribe?${q}`, "cache-control": "no-store" } });
  const plain = (status: number) => new Response(status === 200 ? "Unsubscribed" : "Not unsubscribed", { status, headers: { "content-type": "text/plain", "cache-control": "no-store" } });
  if (!link) return oneClick ? plain(400) : back("");

  const base = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  let ok = false;
  if (base) {
    try {
      const res = await fetch(`${base}/functions/v1/lifecycle/unsubscribe?u=${link.u}&t=${link.t}&via=${oneClick ? "header" : "link"}`, {
        method: "POST",
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      ok = res.ok;
      await res.body?.cancel();
      if (!ok) console.warn(`/unsubscribe/confirm: lifecycle answered ${res.status}`);
    } catch {
      console.warn("/unsubscribe/confirm: lifecycle unreachable");
    }
  }
  if (oneClick) return plain(ok ? 200 : 502);
  return back(ok ? "done=1" : `u=${link.u}&t=${link.t}&failed=1`);
}

export function GET(): Response {
  return new Response(null, { status: 303, headers: { location: "/unsubscribe" } });
}
