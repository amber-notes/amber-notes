import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PREVIEW_NOTES, PREVIEW_SLUG } from "@/lib/preview-notes";
import { copyableMarkdown } from "@/lib/shared";
import OpenCard from "../../OpenCard";

// Dev only: the "Use this note" page from a made-up note, for design review and screenshots.
// Not on the production site.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dev: open copy preview", robots: { index: false, follow: false } };

export default function OpenCopyPreview() {
  if (process.env.VERCEL_ENV === "production") notFound();
  const note = PREVIEW_NOTES.lisbon.note;
  return (
    <OpenCard
      href={`ambernotes://copy/${PREVIEW_SLUG}`}
      what="this note"
      lede={<>Amber Notes adds a copy of <b>{note.title}</b> to your notes. Photos and files stay with the person who shared it.</>}
      markdown={copyableMarkdown(note.body)}
      back={{ href: "/n/preview", label: "Back to the note" }}
    />
  );
}
