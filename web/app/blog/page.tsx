import type { Metadata } from "next";
import { PostCard } from "@/lib/blog";
import { categories, categoryAnchor, published } from "@/lib/posts";
import { pageMetadata } from "@/lib/site";
import { JsonLd, breadcrumbs, maker, incredible, organization } from "@/lib/structured-data";
import Filters from "./Filters";
import home from "../home.module.css";
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
    <div className={home.main}>
      <JsonLd graph={[breadcrumbs([{ name: "Blog", path: "/blog" }]), organization, maker, incredible]} />
      <section className={home.log}>
        <div className={home.logHead}>
          <h1 className={`${home.h2} rise`} style={{ "--i": 0 } as React.CSSProperties}>Blog</h1>
          <p className={`${home.lede} rise`} style={{ "--i": 1 } as React.CSSProperties}>Notes on notes, AI, and building Amber Notes on my own.</p>
          <div className="rise" style={{ "--i": 2 } as React.CSSProperties}><Filters categories={cats} /></div>
        </div>
        <ul id="posts" className={`${s.grid} rise`} style={{ "--i": 3 } as React.CSSProperties}>
          {posts.map((p) => (
            <li key={p.slug} data-category={categoryAnchor(p.category)}><PostCard post={p} /></li>
          ))}
        </ul>
      </section>
    </div>
  );
}
