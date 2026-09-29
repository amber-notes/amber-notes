import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NotePage } from "@/lib/NotePage";
import { summary, withoutTitle } from "@/lib/render";
import { sharedFiles, sharedNote } from "@/lib/shared";

// Edits show within a minute.
export const revalidate = 60;
// No pages at build time; each link is rendered on first visit and cached (ISR).
export async function generateStaticParams() { return []; }

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
