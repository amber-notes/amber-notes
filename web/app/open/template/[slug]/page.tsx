import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { appLink, instructions, noteTitle, template, templates } from "@/lib/templates";
import OpenCard from "../../OpenCard";

// The universal link behind "Use template" (https://ambernotes.app/open/template/<slug>). From
// another site or an email it opens Amber Notes directly; from a click on this site, or where the
// app isn't installed, this page loads and tries the app's scheme.
export const dynamic = "force-static";
export const dynamicParams = false;
export const metadata: Metadata = { title: "Open Amber Notes", robots: { index: false, follow: false } };

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return templates().map((t) => ({ slug: t.slug }));
}

export default async function Page({ params }: Props) {
  const t = template((await params).slug);
  if (!t) notFound();
  return (
    <OpenCard
      href={appLink(t.slug)}
      what="this template"
      lede={<>Amber Notes adds the <b>{noteTitle(t)}</b> note and shows the prompt for your AI.</>}
      markdown={t.note}
      prompt={instructions(t)[0].prompt}
      back={{ href: `/templates/${t.slug}`, label: `See the ${t.title.toLowerCase()} template` }}
    />
  );
}
