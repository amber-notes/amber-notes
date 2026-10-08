import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NotePage } from "@/lib/NotePage";
import { summary, withoutTitle } from "@/lib/render";
import { sharedFiles, sharedNote } from "@/lib/shared";

// Rendered on every visit, never cached: Stop Sharing and locking the note take the page
// down at once, and nothing of a note that was locked is served afterwards.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const note = await sharedNote(slug);
  if (!note) return { title: "Not shared · Amber Notes" };
  const description = summary(withoutTitle(note.body));
  return { title: `${note.title} · Amber Notes`, description, openGraph: { title: note.title, description, siteName: "Amber Notes", type: "article" } };
}

export default async function Page({ params }: Props) {
  const { slug } = await params;
  const note = await sharedNote(slug);
  if (!note) notFound();
  const files = await sharedFiles(slug);
  return <NotePage slug={slug} note={note} files={files} />;
}
