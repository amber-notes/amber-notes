import type { Metadata } from "next";
import { PostCard } from "./blog";
import { categories, categoryPath, newestFirst, pageCount, pageOf, pagePath, published, type Category } from "./posts";
import { pageMetadata } from "./site";
import { JsonLd, breadcrumbs, maker, incredible, organization } from "./structured-data";
import home from "../app/home.module.css";
import s from "../app/blog/blog.module.css";

/// The blog index and each category's page: newest first, PER_PAGE posts a page, the categories as
/// links to their own pages, and previous, numbered and next links at the bottom. Every page is
/// static. Page 1 is the list's own address; later pages are <address>/page/<n>.

const LEDE = "Notes on notes, AI, and building Amber Notes on my own.";

/// What each category's page says under its title (and in search results).
const ABOUT: Record<Category, string> = {
  "Guides": "Guides to connecting ChatGPT, Claude, Gemini, Claude Code and Codex to your notes, and getting things done with them.",
  "Apple Notes": "How-tos for Apple Notes: exporting, recovering, passwords, what's new, and what AI can and can't do with it.",
  "Comparisons": "Notes apps compared fairly: Apple Notes, Notion, Obsidian, and the ones ChatGPT and Claude can use.",
  "Building Amber Notes": "How Amber Notes is built: encryption, AI access, and the decisions behind them.",
};

type List = { category: Category | null; base: string; posts: ReturnType<typeof published> };

function list(category: Category | null): List {
  const all = newestFirst();
  return category
    ? { category, base: categoryPath(category), posts: all.filter((p) => p.category === category) }
    : { category: null, base: "/blog", posts: all };
}

export const pagesOf = (category: Category | null) => pageCount(list(category).posts);

export function blogMetadata(category: Category | null, page: number): Metadata {
  const l = list(category);
  const name = category ?? "Blog";
  const suffix = page > 1 ? `, page ${page}` : "";
  const description = category ? ABOUT[category] : "Guides and comparisons from the maker of Amber Notes: connecting ChatGPT, Claude and Codex to your notes, Apple Notes how-tos, and more.";
  return pageMetadata({
    title: category ? `${name}${suffix} · Blog · Amber Notes` : `Blog${suffix} · Amber Notes`,
    shareTitle: category ? `${name} on the Amber Notes blog` : "The Amber Notes blog",
    description: page > 1 ? `Page ${page} of ${pageCount(l.posts)}. ${description}` : description,
    path: pagePath(l.base, page),
  });
}

export function BlogIndex({ category, page }: { category: Category | null; page: number }) {
  const l = list(category);
  const pages = pageCount(l.posts);
  const posts = pageOf(l.posts, page);
  const crumbs = [{ name: "Blog", path: "/blog" }];
  if (category) crumbs.push({ name: category, path: l.base });
  if (page > 1) crumbs.push({ name: `Page ${page}`, path: pagePath(l.base, page) });
  const counts = categories().map((c) => ({ c, n: published().filter((p) => p.category === c).length }));

  return (
    <div className={home.main}>
      {page > 1 && <link rel="prev" href={pagePath(l.base, page - 1)} />}
      {page < pages && <link rel="next" href={pagePath(l.base, page + 1)} />}
      <JsonLd graph={[breadcrumbs(crumbs), organization, maker, incredible]} />
      <section className={home.log}>
        <div className={home.logHead}>
          <h1 className={`${home.h2} rise`} style={{ "--i": 0 } as React.CSSProperties}>
            {category ?? "Blog"}{page > 1 && <span className={s.pageNote}>, page {page}</span>}
          </h1>
          <p className={`${home.lede} rise`} style={{ "--i": 1 } as React.CSSProperties}>{category ? ABOUT[category] : LEDE}</p>
          <nav className={`${s.filters} rise`} style={{ "--i": 2 } as React.CSSProperties} aria-label="Categories">
            <a href="/blog" aria-current={category === null ? "page" : undefined}>All posts<span className={s.count}>{published().length}</span></a>
            {counts.map(({ c, n }) => (
              <a key={c} href={categoryPath(c)} aria-current={category === c ? "page" : undefined}>{c}<span className={s.count}>{n}</span></a>
            ))}
          </nav>
        </div>
        <ul className={`${s.grid} rise`} style={{ "--i": 3 } as React.CSSProperties}>
          {posts.map((p) => (
            <li key={p.slug}><PostCard post={p} /></li>
          ))}
        </ul>
        {pages > 1 && <Pagination base={l.base} page={page} pages={pages} />}
      </section>
    </div>
  );
}

function Pagination({ base, page, pages }: { base: string; page: number; pages: number }) {
  const numbers = Array.from({ length: pages }, (_, i) => i + 1);
  return (
    <nav className={s.pages} aria-label="Pages">
      {page > 1 ? <a className={s.step} href={pagePath(base, page - 1)} rel="prev">Previous</a> : <span className={s.step} aria-hidden="true" data-off>Previous</span>}
      <ol>
        {numbers.map((n) => (
          <li key={n}>
            <a href={pagePath(base, n)} aria-current={n === page ? "page" : undefined} aria-label={`Page ${n}`}>{n}</a>
          </li>
        ))}
      </ol>
      {page < pages ? <a className={s.step} href={pagePath(base, page + 1)} rel="next">Next</a> : <span className={s.step} aria-hidden="true" data-off>Next</span>}
    </nav>
  );
}
