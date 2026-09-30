import { readFileSync } from "node:fs";
import path from "node:path";
import b from "./blog.module.css";
import { AUTHOR, categoryAnchor, type CoverArt, type Ground, type Post, type Shot } from "./posts";

/// The blog's shared pieces: a capture in a Mac window, the desk it sits on, the byline and the card.

export const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/// Minutes to read a post, from the words in its page source (tags and code stripped), at 220 a minute.
export function readingMinutes(slug: string): number {
  const src = readFileSync(path.join(process.cwd(), "app/blog", slug, "page.tsx"), "utf8");
  const body = src.slice(src.indexOf("return ("));
  const words = body.replace(/<[^>]*>/g, " ").replace(/\{[^{}]*\}/g, " ").replace(/&[a-z]+;/g, "'").split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  return Math.max(1, Math.round(words.length / 220));
}

/// A real capture in a Mac window. Captures of a whole window come with their own frame; sheets and
/// forms get a title bar drawn around them. Shown at most at its natural size in points (captures are
/// 2x), and never taller than about 560 px, so a tall capture doesn't push the text off the screen.
export function Window({ shot, priority = false }: { shot: Shot; priority?: boolean }) {
  const style = { "--w": `${Math.round(Math.min(shot.width / 2, (560 * shot.width) / shot.height))}px` } as React.CSSProperties;
  const img = (
    <img src={shot.src} alt={shot.alt} width={shot.width / 2} height={shot.height / 2}
      loading={priority ? "eager" : "lazy"} decoding="async" fetchPriority={priority ? "high" : undefined} />
  );
  if (shot.window) return <div className={b.captured} style={style}>{img}</div>;
  return (
    <div className={b.window} style={style}>
      <div className={b.bar} aria-hidden="true">
        <span className={b.lights}><i /><i /><i /></span>
        {shot.title && <span className={b.barTitle}>{shot.title}</span>}
      </div>
      {img}
    </div>
  );
}

/// A capture on a ground: the post's own at the top, a soft one further down.
export function Figure({ shot, caption, priority, ground = "soft" }: { shot: Shot; caption?: string; priority?: boolean; ground?: Ground }) {
  return (
    <figure className={b.figure}>
      <div className={`${b.stage} ${b.ground}`} data-ground={ground}><Window shot={shot} priority={priority} /></div>
      {caption && <figcaption className={b.caption}>{caption}</figcaption>}
    </figure>
  );
}

/// A card's picture: real captures placed on the post's ground. Each post composes its own (see
/// lib/posts.ts), with the same corners and the same light, so they read as one family.
export function Cover({ art }: { art: CoverArt }) {
  return (
    <div className={`${b.cover} ${b.ground}`} data-ground={art.ground} aria-hidden="true">
      {art.layers.map((l, i) => {
        const place = { left: `${l.left}%`, top: `${l.top}%`, width: `${l.size}%` } as React.CSSProperties;
        const img = <img src={l.src} alt="" width={l.width / 2} height={l.height / 2} loading="lazy" decoding="async" />;
        if (l.frame === "window") {
          return (
            <div key={i} className={`${b.layer} ${b.window}`} data-dark={l.dark || undefined} style={place}>
              <div className={b.bar}><span className={b.lights}><i /><i /><i /></span>{l.title && <span className={b.barTitle}>{l.title}</span>}</div>
              {img}
            </div>
          );
        }
        return <div key={i} className={`${b.layer} ${l.frame === "card" ? b.card2 : l.frame === "art" ? b.art : b.bare}`} style={place}>{img}</div>;
      })}
    </div>
  );
}

export function Avatar({ size = 24 }: { size?: number }) {
  return <img className={b.avatar} src={AUTHOR.avatar} alt="" width={size} height={size} />;
}

/// One post on the index or under "More posts".
export function PostCard({ post, heading = "h2" }: { post: Post; heading?: "h2" | "h3" }) {
  const H = heading;
  return (
    <a className={b.card} href={`/blog/${post.slug}`} data-category={categoryAnchor(post.category)}>
      <Cover art={post.cover} />
      <span className={b.cardText}>
        <span className={b.label}>{post.category}</span>
        <H className={b.cardTitle}>{post.title}</H>
        <span className={b.excerpt}>{post.excerpt}</span>
        <span className={b.byline}>
          <Avatar size={20} />
          <span>{AUTHOR.name}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={post.date}>{longDate(post.date)}</time>
        </span>
      </span>
    </a>
  );
}
