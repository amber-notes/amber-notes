import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NOTE_DESIGN, NotePage, type NoteDesign } from "@/lib/NotePage";
import { PREVIEW_FILES, PREVIEW_NOTES, PREVIEW_SLUG } from "@/lib/preview-notes";

// Dev only: the shared-note page from made-up notes, with no backend, for design review and
// screenshots (/n/preview?note=lisbon|long|sub&design=sheet|page). Not on the production site. "preview" is too short
// to be a share link's slug, so this never stands in front of a real note.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dev: shared note preview", robots: { index: false, follow: false } };

export default async function NotePreview({ searchParams }: { searchParams: Promise<{ note?: string; design?: string }> }) {
  if (process.env.VERCEL_ENV === "production") notFound();
  const { note, design } = await searchParams;
  const pick = PREVIEW_NOTES[note ?? ""] ?? PREVIEW_NOTES.lisbon;
  return <NotePage slug={PREVIEW_SLUG} note={pick.note} files={PREVIEW_FILES} design={design === "sheet" || design === "page" ? (design as NoteDesign) : NOTE_DESIGN} />;
}
