import type { Metadata } from "next";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { renderNote } from "@/lib/render";

// Copied from docs/privacy-policy.md at build time (scripts/deploy-web.sh refreshes the copy).
const markdown = readFileSync(join(process.cwd(), "content/privacy-policy.md"), "utf8");
const title = markdown.match(/^#\s+(.+)$/m)?.[1] ?? "Privacy Policy";
const body = markdown.replace(/^#\s+.+\n+/, "");

export const dynamic = "force-static";
export const metadata: Metadata = {
  title: `${title} · Amber Notes`,
  description: "How Amber Notes handles your data.",
  robots: { index: true, follow: true },
};

export default function Privacy() {
  const html = renderNote(body, { files: {}, subNoteHref: () => null });
  return (
    <div className="shell">
      <header className="bar">
        <Link href="/" className="brand" aria-label="Amber Notes">
          <img src="/mark.png" alt="" width={22} height={22} />
          <span>Amber Notes</span>
        </Link>
      </header>
      <main className="page">
        <h1 className="title">{title}</h1>
        <article className="note" dangerouslySetInnerHTML={{ __html: html }} />
      </main>
    </div>
  );
}
