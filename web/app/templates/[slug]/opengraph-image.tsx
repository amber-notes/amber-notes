import { renderTemplateCard } from "@/lib/og/render";
import { COVERS, inkOn } from "@/lib/template-covers";
import { template, templates } from "@/lib/templates";

export { size, contentType } from "@/lib/og/render";
export const alt = "An Amber Notes template that ChatGPT, Claude and Claude Code fill in.";

export function generateStaticParams() {
  return templates().map((t) => ({ slug: t.slug }));
}

export default async function OpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const t = template((await params).slug)!;
  const ground = COVERS[t.slug].ground;
  return renderTemplateCard({ slug: t.slug, title: t.title, tagline: t.tagline, ground, ink: inkOn(ground) });
}
