import type { Metadata } from "next";
import legal from "./legal.module.css";
import p from "./post.module.css";
import { Avatar, Figure, PostCard, longDate, readingMinutes } from "./blog";
import { AUTHOR, categories, categoryAnchor, morePosts, post, published, type Post } from "./posts";
import { MAKER_URL, SITE_URL, pageMetadata } from "./site";
import { JsonLd, article, breadcrumbs, faqPage, incredible, maker, organization } from "./structured-data";

type QA = { q: string; a: string[] };

/// A post's metadata from its entry in lib/posts.ts: drafts stay out of search.
export function postMetadata(slug: string, { title }: { title?: string } = {}): Metadata {
  const x = post(slug);
  return pageMetadata({
    title: title ?? `${x.title} · Amber Notes`,
    shareTitle: x.title,
    description: x.description,
    path: `/blog/${x.slug}`,
    index: !x.draft,
    article: { published: x.date, modified: x.updated, author: AUTHOR.name },
  });
}

function share(x: Post) {
  const url = `${SITE_URL}/blog/${x.slug}`;
  const e = encodeURIComponent;
  return [
    { name: "X", href: `https://x.com/intent/post?text=${e(x.title)}&url=${e(url)}`, glyph: <XGlyph /> },
    { name: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${e(url)}`, glyph: <LinkedInGlyph /> },
    { name: "Email", href: `mailto:?subject=${e(x.title)}&body=${e(`${x.title}\n${url}`)}`, glyph: <MailGlyph /> },
  ];
}

function Share({ x, row = false }: { x: Post; row?: boolean }) {
  return (
    <div className={row ? p.shareRow : p.share}>
      <p className={p.shareLabel}>Share this post</p>
      <ul>
        {share(x).map((s) => (
          <li key={s.name}>
            <a href={s.href} target={s.name === "Email" ? undefined : "_blank"} rel="noopener noreferrer" aria-label={`Share on ${s.name}`}>
              {s.glyph}<span>{s.name}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/// Every other published post by title, grouped by category once there are more than a few.
function AllPosts({ slug }: { slug: string }) {
  const others = published().filter((x) => x.slug !== slug);
  const grouped = others.length > 6;
  const list = (items: Post[]) => (
    <ul>{items.map((x) => <li key={x.slug}><a href={`/blog/${x.slug}`}>{x.title}</a></li>)}</ul>
  );
  return (
    <nav className={p.all} aria-labelledby="all-posts">
      <h2 id="all-posts" className={p.sectionTitle}>All posts</h2>
      {grouped ? (
        <div className={p.allGroups}>
          {categories().map((c) => {
            const items = others.filter((x) => x.category === c);
            return items.length ? (
              <div key={c}>
                <h3><a href={`/blog#${categoryAnchor(c)}`}>{c}</a></h3>
                {list(items)}
              </div>
            ) : null;
          })}
        </div>
      ) : list(others)}
    </nav>
  );
}

/// A blog post: the date and category, the title, the byline, an intro, a real capture of the app,
/// then the text in the legal pages' readable column. A share rail on wide screens, and at the end
/// two more posts and every other post by title. Emits Article, BreadcrumbList and (when the post
/// has real questions) FAQPage JSON-LD.
export function PostPage({ slug, intro, faq, children }: { slug: string; intro: React.ReactNode; faq?: QA[]; children: React.ReactNode }) {
  const x = post(slug);
  const path = `/blog/${x.slug}`;
  const minutes = readingMinutes(slug);
  const graph = [
    article({ title: x.title, description: x.description, path, date: x.date, updated: x.updated, image: x.image.src }),
    breadcrumbs([{ name: "Blog", path: "/blog" }, { name: x.category, path: `/blog#${categoryAnchor(x.category)}` }, { name: x.title, path }]),
    organization, maker, incredible,
  ];
  if (faq?.length) graph.push(faqPage(faq, path));
  const more = morePosts(slug);

  return (
    <div className={p.main}>
      <JsonLd graph={graph} />
      <aside className={p.rail}>
        <div className={p.railInner}>
          <a className={p.back} href="/blog"><ArrowGlyph /> All posts</a>
          <Share x={x} />
        </div>
      </aside>

      <article className={p.col}>
        <header className={`${p.head} rise`} style={{ "--i": 0 } as React.CSSProperties}>
          <nav className={p.crumbs} aria-label="Breadcrumb">
            <ol>
              <li><a href="/blog">Blog</a></li>
              <li><a href={`/blog#${categoryAnchor(x.category)}`}>{x.category}</a></li>
            </ol>
          </nav>
          <p className={p.meta}>
            Published <time dateTime={x.date}>{longDate(x.date)}</time> in{" "}
            <a href={`/blog#${categoryAnchor(x.category)}`}>{x.category}</a>
          </p>
          <h1 className={p.title}>{x.title}</h1>
          <div className={p.byline}>
            <Avatar size={28} />
            <span>By <a className={p.author} href={MAKER_URL} rel="author">{AUTHOR.name}</a></span>
            <span aria-hidden="true">·</span>
            <span>{minutes} min read</span>
          </div>
          <Share x={x} row />
        </header>

        <div className={`${legal.article} ${p.body} rise`} style={{ "--i": 1 } as React.CSSProperties}>
          <p className={p.intro}>{intro}</p>
          <Figure shot={x.image} ground={x.cover.ground} priority />
          {children}
          {faq?.length ? (
            <>
              <h2>Questions</h2>
              {faq.map((it) => (
                <div key={it.q}>
                  <p className="label"><strong>{it.q}</strong></p>
                  {it.a.map((t) => <p key={t}>{t}</p>)}
                </div>
              ))}
            </>
          ) : null}
          <p className={p.checked}>Checked against the app on <time dateTime={x.updated}>{longDate(x.updated)}</time>.</p>
        </div>
      </article>

      <div className={p.end}>
        {more.length ? (
          <section aria-labelledby="more-posts">
            <h2 id="more-posts" className={p.sectionTitle}>More posts</h2>
            <ul className={p.more}>{more.map((m) => <li key={m.slug}><PostCard post={m} heading="h3" /></li>)}</ul>
          </section>
        ) : null}
        <AllPosts slug={slug} />
      </div>
    </div>
  );
}

function ArrowGlyph() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 3 5 8l5 5" /></svg>;
}
function XGlyph() {
  return <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M18.9 1.2h3.7l-8 9.2L24 22.8h-7.4l-5.8-7.6-6.6 7.6H.5l8.6-9.8L0 1.2h7.6l5.2 6.9 6.1-6.9Zm-1.3 19.4h2L6.5 3.3H4.3Z" /></svg>;
}
function LinkedInGlyph() {
  return <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z" /></svg>;
}
function MailGlyph() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>;
}
