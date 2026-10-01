import { renderCard } from "@/lib/og/render";
import { template, templates } from "@/lib/templates";

export { size, contentType } from "@/lib/og/render";
export const alt = "An Amber Notes template that ChatGPT, Claude and Claude Code fill in.";

export function generateStaticParams() {
  return templates().map((t) => ({ slug: t.slug }));
}

export default async function OpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const t = template((await params).slug)!;
  return renderCard({
    theme: "cream",
    title: `${t.title} [template]`,
    sub: t.description,
    chips: [t.category, "ChatGPT", "Claude"],
    art: "icon",
    titleSize: 76,
  });
}
