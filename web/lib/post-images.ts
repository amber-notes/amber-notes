import { readFileSync } from "node:fs";
import path from "node:path";
import { posts, SHOTS, type Shot } from "./posts";

/// The captures a post shows, for the image sitemap: its first picture, then each <Figure> in its
/// page source, in order, once each. Every figure names its capture as SHOTS.<name>.
export function postShots(slug: string): Shot[] {
  const post = posts.find((p) => p.slug === slug);
  if (!post) return [];
  const src = readFileSync(path.join(process.cwd(), "app/blog", slug, "page.tsx"), "utf8");
  const figures = [...src.matchAll(/<Figure\s+shot=\{SHOTS\.(\w+)\}/g)].map((m) => SHOTS[m[1] as keyof typeof SHOTS]);
  return [...new Set([post.image, ...figures])];
}
