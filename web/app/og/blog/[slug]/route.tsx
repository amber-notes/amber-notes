import { renderCard } from "@/lib/og/render";
import { post, published } from "@/lib/posts";

// Each blog post's share card (1200 × 630): its title beside its cover. Built at build time, one PNG
// per published post, at /og/blog/<slug>. postMetadata points og:image and twitter:image here.
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return published().map((p) => ({ slug: p.slug }));
}

export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const x = post((await params).slug);
  return renderCard({
    theme: "cream",
    title: x.title,
    sub: x.category,
    art: { name: x.thumb.src.replace(/^\/blog\//, "").replace(/\.webp$/, ""), width: x.thumb.width, height: x.thumb.height },
    titleSize: x.title.length > 60 ? 54 : x.title.length > 40 ? 62 : 70,
  });
}
