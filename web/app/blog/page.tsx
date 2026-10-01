import { BlogIndex, blogMetadata } from "@/lib/BlogIndex";

export const dynamic = "force-static";
export const metadata = blogMetadata(null, 1);

export default function Page() {
  return <BlogIndex category={null} page={1} />;
}
