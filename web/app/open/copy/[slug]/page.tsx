import type { Metadata } from "next";
import { copyableMarkdown, sharedNote, validSlug } from "@/lib/shared";
import OpenCard from "../../OpenCard";
import s from "../../open.module.css";

// The universal link behind a shared page's "Use this note" (https://ambernotes.app/open/copy/<slug>).
// Read on every visit, like the shared page: Stop Sharing takes this down at once too.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Open Amber Notes", robots: { index: false, follow: false } };

type Props = { params: Promise<{ slug: string }> };

export default async function Page({ params }: Props) {
  const { slug } = await params;
  const note = validSlug(slug) ? await sharedNote(slug) : null;
  if (!note || note.is_sub) {
    return (
      <div className={s.page}>
        <div className={s.card}>
          <img className={s.mark} src="/mark-256.png" alt="" width={56} height={56} />
          <h1 className={s.title}>This note isn&apos;t shared anymore</h1>
          <p className={s.lede}>Its owner stopped sharing it, or the link isn&apos;t complete. Ask them for a new link.</p>
          <a className={s.primary} href="/templates">Browse templates</a>
        </div>
      </div>
    );
  }
  return (
    <OpenCard
      href={`ambernotes://copy/${slug}`}
      title="Opening Amber Notes"
      lede={<>Amber Notes adds a copy of <b>{note.title}</b> to your notes. Photos and files stay with the person who shared it. If it didn&apos;t open, try again.</>}
      markdown={copyableMarkdown(note.body)}
      back={{ href: `/n/${slug}`, label: "Back to the note" }}
    />
  );
}
