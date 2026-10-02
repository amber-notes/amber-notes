import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ConnectCard from "../ConnectCard";
import Preview from "./Preview";
import { PREVIEW_STATES, type PreviewState } from "./states";

// Dev only: each state of the connect page from fixed props, with no network, for design review and
// screenshots (/connect/preview?state=scan). Not on the production site.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dev: connect preview", robots: { index: false, follow: false } };

export default async function ConnectPreview({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.VERCEL_ENV === "production") notFound();
  const { state } = await searchParams;
  const s: PreviewState = (PREVIEW_STATES as readonly string[]).includes(state ?? "") ? state as PreviewState : "scan";
  return (
    <ConnectCard>
      <Preview state={s} />
    </ConnectCard>
  );
}
