import { notFound } from "next/navigation";
import { BlogIndex, blogMetadata, pagesOf } from "@/lib/BlogIndex";

// Pages 2 and on of the blog index, built at build time. Page 1 is /blog (/blog/page/1 redirects).
export const dynamicParams = false;

export function generateStaticParams() {
  return Array.from({ length: pagesOf(null) - 1 }, (_, i) => ({ n: String(i + 2) }));
}

type Props = { params: Promise<{ n: string }> };

const pageNumber = async ({ params }: Props) => {
  const n = Number((await params).n);
  if (!Number.isInteger(n) || n < 2 || n > pagesOf(null)) notFound();
  return n;
};

export async function generateMetadata(props: Props) {
  return blogMetadata(null, await pageNumber(props));
}

export default async function Page(props: Props) {
  return <BlogIndex category={null} page={await pageNumber(props)} />;
}
