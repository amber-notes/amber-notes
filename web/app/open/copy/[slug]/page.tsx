import type { Metadata } from "next";
import { copyableMarkdown, sharedNote, validSlug } from "@/lib/shared";
import OpenCard from "../../OpenCard";
import { EmptyState, Stage, ui } from "@/lib/ui";

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
      <Stage inSite>
        <EmptyState title="This note isn't shared anymore" actions={<a className={ui.primary} href="/templates">Browse templates</a>}>
          Its owner stopped sharing it, or the link isn&apos;t complete. Ask them for a new link.
        </EmptyState>
      </Stage>
    );
  }
  return (
    <OpenCard
      href={`ambernotes://copy/${slug}`}
      what="this note"
      lede={<>Amber Notes adds a copy of <b>{note.title}</b> to your notes. Photos and files stay with the person who shared it.</>}
      markdown={copyableMarkdown(note.body)}
      back={{ href: `/n/${slug}`, label: "Back to the note" }}
    />
  );
}
