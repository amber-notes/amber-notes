import { notFound } from "next/navigation";
import { BlogIndex, blogMetadata } from "@/lib/BlogIndex";
import { categories, categoryAnchor, categoryFromAnchor } from "@/lib/posts";

// Each category's own page: its posts, newest first, paged like the index.
export const dynamicParams = false;

export function generateStaticParams() {
  return categories().map((c) => ({ category: categoryAnchor(c) }));
}

type Props = { params: Promise<{ category: string }> };

const categoryOf = async ({ params }: Props) => categoryFromAnchor((await params).category) ?? notFound();

export async function generateMetadata(props: Props) {
  return blogMetadata(await categoryOf(props), 1);
}

export default async function Page(props: Props) {
  return <BlogIndex category={await categoryOf(props)} page={1} />;
}
