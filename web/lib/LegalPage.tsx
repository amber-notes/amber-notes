import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { SKIP, visit } from "unist-util-visit";
import styles from "./legal.module.css";

/// The privacy policy and terms: our own markdown (docs/*.md, copied to content/ on deploy),
/// so unlike shared notes it isn't sanitized, and every section gets an anchor for the contents.

type Section = { id: string; title: string };
type Legal = { title: string; updated: string | null; summary: string | null; html: string; sections: Section[] };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function toHtml(markdown: string, sections?: Section[]): string {
  return String(
    unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype)
      .use(() => (tree) => {
        visit(tree, "element", (node: any) => {
          // A paragraph that is only a bold phrase ("**Your account**") is a small subheading.
          if (node.tagName === "p") {
            const kids = (node.children ?? []).filter((c: any) => !(c.type === "text" && !c.value.trim()));
            if (kids.length === 1 && kids[0].tagName === "strong") node.properties = { ...node.properties, className: ["label"] };
          }
          if (node.tagName === "h2" && sections) {
            const text = (node.children ?? []).map((c: any) => c.value ?? "").join("");
            const id = slug(text);
            node.properties = { ...node.properties, id };
            sections.push({ id, title: text });
          }
          if (node.tagName === "a" && /^https?:/.test(String(node.properties?.href ?? ""))) {
            node.properties = { ...node.properties, rel: "noopener" };
          }
          if (node.tagName === "table") {
            // Wide tables scroll on their own on phones.
            const table = { ...node };
            node.tagName = "div";
            node.properties = { className: ["tableWrap"] };
            node.children = [table];
            return SKIP; // don't visit the table again inside its new wrapper
          }
        });
      })
      .use(rehypeStringify)
      .processSync(markdown),
  );
}

export function readLegal(file: string): Legal {
  let md = readFileSync(join(process.cwd(), "content", file), "utf8");
  const title = md.match(/^#\s+(.+)$/m)?.[1] ?? "Amber Notes";
  md = md.replace(/^#\s+.+\n+/, "");
  const updated = md.match(/^Last updated:\s*(.+)$/m)?.[1]?.trim() ?? null;
  md = md.replace(/^Last updated:.*\n+/m, "");
  // "The short version" is shown as its own card above the contents.
  let summary: string | null = null;
  const short = md.match(/^## The short version\n([\s\S]*?)(?=^## )/m);
  if (short) {
    summary = toHtml(short[1]);
    md = md.replace(short[0], "");
  }
  const sections: Section[] = [];
  const html = toHtml(md, sections);
  return { title, updated, summary, html, sections };
}

export function LegalPage({ doc, other }: { doc: Legal; other: { href: string; label: string } }) {
  const r = (i: number) => ({ "--i": i }) as React.CSSProperties;
  return (
    <div className={styles.main}>
      <div className={`${styles.head} rise`} style={r(0)}>
        <h1 className={styles.title}>{doc.title}</h1>
        {doc.updated && <p className={styles.updated}>Last updated {doc.updated}</p>}
      </div>

      {doc.summary && (
        <section className={`${styles.summary} rise`} style={r(1)} aria-labelledby="short-version">
          <h2 id="short-version" className={styles.summaryTitle}>The short version</h2>
          <div className={styles.summaryBody} dangerouslySetInnerHTML={{ __html: doc.summary }} />
        </section>
      )}

      <div className={`${styles.layout} rise`} style={r(2)}>
        <nav className={styles.toc} aria-label="On this page">
          <details open className={styles.tocDetails}>
            <summary className={styles.tocLabel}>On this page</summary>
            <ol>
              {doc.sections.map((s) => (
                <li key={s.id}><a href={`#${s.id}`}>{s.title}</a></li>
              ))}
            </ol>
          </details>
          <p className={styles.tocOther}><a href={other.href}>{other.label} →</a></p>
        </nav>
        <article className={styles.article} dangerouslySetInnerHTML={{ __html: doc.html }} />
      </div>
    </div>
  );
}
