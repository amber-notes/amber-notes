import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NOT_FOUND_DESIGN, NotFoundView, type NotFoundDesign } from "@/lib/NotFoundView";

// Dev only: the 404's two candidate looks side by side for a pick (/dev/not-found?design=hero|note).
// Not on the production site.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dev: not-found preview", robots: { index: false, follow: false } };

export default async function NotFoundPreview({ searchParams }: { searchParams: Promise<{ design?: string }> }) {
  if (process.env.VERCEL_ENV === "production") notFound();
  const { design } = await searchParams;
  return <NotFoundView design={design === "hero" || design === "note" ? (design as NotFoundDesign) : NOT_FOUND_DESIGN} />;
}
