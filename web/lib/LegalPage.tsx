import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { SKIP, visit } from "unist-util-visit";
import { LegalToc, type Section } from "./LegalToc";
import styles from "./legal.module.css";

/// The privacy policy and terms: our own markdown (docs/*.md, copied to content/ on deploy),
/// so unlike shared notes it isn't sanitized, and every section gets an anchor for the contents
/// and a "#" beside its heading that links to it.

type Legal = { title: string; updated: string | null; summary: string | null; html: string; sections: Section[] };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/// The "#" beside a section's heading: the link to that section, shown on hover and on focus.
const anchor = (id: string, title: string) => ({
  type: "element", tagName: "a", properties: { href: `#${id}`, className: ["anchor"], ariaLabel: `Link to the section “${title}”` },
  children: [{ type: "text", value: "#" }],
});

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
            node.children = [...(node.children ?? []), anchor(id, text)];
            sections.push({ id, title: text });
          }
          if (node.tagName === "a" && /^https?:/.test(String(node.properties?.href ?? ""))) {
            node.properties = { ...node.properties, target: "_blank", rel: "noopener noreferrer" };
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
  const title = md.match(/^#\s+(.+)$/m)?.[1] ?? "Pinto Notes";
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

/// A section heading with its id and "#" link, for long pages written as JSX (Privacy & Security).
export function SectionHeading({ id, children }: { id: string; children: string }) {
  return (
    <h2 id={id}>
      {children}
      <a className="anchor" href={`#${id}`} aria-label={`Link to the section “${children}”`}>#</a>
    </h2>
  );
}

/// The long text pages' layout: the contents in the left margin on wide screens (the blog's share
/// rail is in the same place), the readable column, and on narrower screens the contents as one
/// row above the text. `lead` is what sits between the title and the text.
export function LongPage({ title, sub, lead, sections, other, children }: {
  title: string; sub?: React.ReactNode; lead?: React.ReactNode; sections: Section[]; other?: { href: string; label: string }; children: React.ReactNode;
}) {
  return (
    <div className={styles.grid}>
      <aside className={styles.rail}>
        <div className={styles.railInner}><LegalToc sections={sections} other={other} place="rail" /></div>
      </aside>
      <div className={styles.gridCol}>
        <div className={`${styles.head} rise`} style={{ "--i": 0 } as React.CSSProperties}>
          <h1 className={styles.title}>{title}</h1>
          {sub && <p className={styles.updated}>{sub}</p>}
        </div>
        {lead}
        <div className={`${styles.foldRow} rise`} style={{ "--i": 2 } as React.CSSProperties}>
          <LegalToc sections={sections} other={other} place="fold" />
        </div>
        {children}
      </div>
    </div>
  );
}

export function LegalPage({ doc, other }: { doc: Legal; other: { href: string; label: string } }) {
  return (
    <LongPage
      title={doc.title}
      sub={doc.updated ? `Last updated ${doc.updated}` : undefined}
      sections={doc.sections}
      other={other}
      lead={doc.summary && (
        <section className={`${styles.summary} rise`} style={{ "--i": 1 } as React.CSSProperties} aria-labelledby="short-version">
          <h2 id="short-version" className={styles.summaryTitle}>The short version</h2>
          <div className={styles.summaryBody} dangerouslySetInnerHTML={{ __html: doc.summary }} />
        </section>
      )}
    >
      <article className={`${styles.article} rise`} style={{ "--i": 3 } as React.CSSProperties} dangerouslySetInnerHTML={{ __html: doc.html }} />
    </LongPage>
  );
}
