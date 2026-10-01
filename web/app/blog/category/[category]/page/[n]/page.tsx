import { notFound } from "next/navigation";
import { BlogIndex, blogMetadata, pagesOf } from "@/lib/BlogIndex";
import { categories, categoryAnchor, categoryFromAnchor } from "@/lib/posts";

// Pages 2 and on of a category, for when it holds more than one page of posts.
export const dynamicParams = false;

export function generateStaticParams() {
  return categories().flatMap((c) => Array.from({ length: pagesOf(c) - 1 }, (_, i) => ({ category: categoryAnchor(c), n: String(i + 2) })));
}

type Props = { params: Promise<{ category: string; n: string }> };

async function resolve({ params }: Props) {
  const p = await params;
  const category = categoryFromAnchor(p.category) ?? notFound();
  const n = Number(p.n);
  if (!Number.isInteger(n) || n < 2 || n > pagesOf(category)) notFound();
  return { category, n };
}

export async function generateMetadata(props: Props) {
  const { category, n } = await resolve(props);
  return blogMetadata(category, n);
}

export default async function Page(props: Props) {
  const { category, n } = await resolve(props);
  return <BlogIndex category={category} page={n} />;
}
