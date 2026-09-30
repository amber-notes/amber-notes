import type { Metadata } from "next";
import { PostCard } from "@/lib/blog";
import { categories, categoryAnchor, published } from "@/lib/posts";
import { pageMetadata } from "@/lib/site";
import { JsonLd, breadcrumbs, maker, incredible, organization } from "@/lib/structured-data";
import Filters from "./Filters";
import s from "./blog.module.css";

export const dynamic = "force-static";
export const metadata: Metadata = pageMetadata({
  title: "Blog · Amber Notes",
  shareTitle: "The Amber Notes blog",
  description: "Guides and comparisons from the maker of Amber Notes: connecting ChatGPT, Claude and Codex to your notes, moving from Apple Notes, and more.",
  path: "/blog",
});

export default function Page() {
  const posts = published();
  const cats = categories().map((c) => ({ name: c, anchor: categoryAnchor(c), count: posts.filter((p) => p.category === c).length }));
  return (
    <div className={s.main}>
      <JsonLd graph={[breadcrumbs([{ name: "Blog", path: "/blog" }]), organization, maker, incredible]} />
      <aside className={`${s.side} rise`} style={{ "--i": 0 } as React.CSSProperties}>
        <h1 className={s.title}>Blog</h1>
        <p className={s.intro}>Notes on notes, AI, and building Amber Notes on my own.</p>
        <Filters categories={cats} />
      </aside>
      <ul id="posts" className={`${s.grid} rise`} style={{ "--i": 1 } as React.CSSProperties}>
        {posts.map((p) => (
          <li key={p.slug} data-category={categoryAnchor(p.category)}><PostCard post={p} /></li>
        ))}
      </ul>
    </div>
  );
}
