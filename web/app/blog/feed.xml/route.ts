import { feedXml } from "@/lib/feed";

export const dynamic = "force-static";

export function GET() {
  return new Response(feedXml(), { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
