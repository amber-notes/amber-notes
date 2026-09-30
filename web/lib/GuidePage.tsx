import type { Metadata } from "next";
import styles from "./legal.module.css";
import { guide, type Guide } from "./guides";
import { pageMetadata } from "./site";
import { JsonLd, article, faqPage, maker, organization } from "./structured-data";

type QA = { q: string; a: string[] };

/// A guide's metadata from its entry in lib/guides.ts: drafts stay out of search.
export function guideMetadata(slug: string, { title, shareTitle }: { title?: string; shareTitle?: string } = {}): Metadata {
  const g = guide(slug);
  return pageMetadata({
    title: title ?? `${g.title} · Amber Notes`,
    shareTitle: shareTitle ?? g.title,
    description: g.description,
    path: `/guides/${g.slug}`,
    index: !g.draft,
  });
}

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/// A guide (/guides/*): the legal pages' centred column and prose styles, a headline, a lede and
/// the day it was last checked. Emits Article JSON-LD, plus FAQPage when the guide has real questions.
export function GuidePage({ slug, lede, faq, children }: { slug: string; lede: string; faq?: QA[]; children: React.ReactNode }) {
  const g: Guide = guide(slug);
  const path = `/guides/${g.slug}`;
  const graph = [article({ title: g.title, description: g.description, path, updated: g.updated }), organization, maker];
  if (faq?.length) graph.push(faqPage(faq, path));
  return (
    <div className={styles.main}>
      <JsonLd graph={graph} />
      <div className={styles.col}>
        <header className={`${styles.head} rise`} style={{ "--i": 0 } as React.CSSProperties}>
          <h1 className={styles.title}>{g.title}</h1>
          <p className={styles.updated}>{lede}</p>
          <p className={styles.checked}>Checked against the app on <time dateTime={g.updated}>{day(g.updated)}</time></p>
        </header>
        <article className={`${styles.article} rise`} style={{ "--i": 1 } as React.CSSProperties}>
          {children}
          {faq?.length ? (
            <>
              <h2>Questions</h2>
              {faq.map((it) => (
                <div key={it.q}>
                  <p className="label"><strong>{it.q}</strong></p>
                  {it.a.map((p) => <p key={p}>{p}</p>)}
                </div>
              ))}
            </>
          ) : null}
          <p className={styles.more}><a href="/guides">All guides</a></p>
        </article>
      </div>
    </div>
  );
}
