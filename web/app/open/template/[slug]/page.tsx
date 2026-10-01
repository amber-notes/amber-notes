import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { appLink, template, templates } from "@/lib/templates";
import OpenCard from "../../OpenCard";

// The universal link behind "Use this template" (https://ambernotes.app/open/template/<slug>).
// Where Amber Notes is installed, the link opens it and this never loads.
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
      title="Opening Amber Notes"
      lede={<>Amber Notes adds the <b>{t.note.split("\n")[0]}</b> note and shows the prompt for your AI. If it didn&apos;t open, try again.</>}
      markdown={t.note}
      back={{ href: `/templates/${t.slug}`, label: `See the ${t.title.toLowerCase()} template` }}
    />
  );
}
