import { publicTemplate, template, templates } from "@/lib/templates";

// /templates/<slug>.json (next.config.ts rewrites it here): the public, read-only data the app
// fetches for "Use this template". Built once per template; any other slug is a 404.
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return templates().map((t) => ({ slug: t.slug }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const t = template((await params).slug);
  if (!t) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(publicTemplate(t));
}
