import { starCount } from "@/lib/github";

// /stars.json: the repository's star count for the header (app/GitHubLink.tsx). Pages are static, so
// the count they were built with goes stale; this refreshes it every 10 minutes, and the CDN serves
// it in between. When GitHub fails, stars is null and the header keeps the number it has.
export const revalidate = 600;

export async function GET() {
  const stars = await starCount(revalidate);
  return Response.json({ stars }, { headers: { "Cache-Control": "public, max-age=0, s-maxage=600, stale-while-revalidate=600" } });
}
