import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ConnectCard from "../ConnectCard";
import { designFrom } from "../ConnectScreen";
import PreviewScreen, { type PreviewState } from "./PreviewScreen";

/// Kept here, not in the client module: a server page can't read a client module's values.
const PREVIEW_STATES: readonly PreviewState[] = ["signIn", "waiting", "number", "recover", "leaving"];

// Dev only: every state of the connect page, from fixed props and with no network, for comparing
// layouts. /connect/preview?design=current|a|b|c&state=signIn|waiting|number|recover|leaving[&nudge=1]
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connect preview (Dev)", robots: { index: false, follow: false } };

export default async function ConnectPreview({ searchParams }: { searchParams: Promise<{ design?: string; state?: string; nudge?: string }> }) {
  if (process.env.VERCEL_ENV === "production") notFound();
  const { design, state, nudge } = await searchParams;
  const s: PreviewState = (PREVIEW_STATES as readonly string[]).includes(state ?? "") ? (state as PreviewState) : "signIn";
  return (
    <ConnectCard>
      <PreviewScreen design={designFrom(design)} state={s} nudge={nudge === "1"} />
    </ConnectCard>
  );
}
