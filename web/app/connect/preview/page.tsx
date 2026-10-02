import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { lookFor } from "@/lib/connect";
import ConnectCard from "../ConnectCard";
import Preview from "./Preview";
import styles from "../connect.module.css";
import { PREVIEW_STATES, type PreviewState } from "./states";

// Dev only: each state of the connect page from fixed props, with no network, for design review and
// screenshots (/connect/preview?state=scan). Not on the production site.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Dev: connect preview", robots: { index: false, follow: false } };

export default async function ConnectPreview({ searchParams }: { searchParams: Promise<{ state?: string; art?: string; number?: string; action?: string; both?: string; theme?: string; look?: string }> }) {
  if (process.env.VERCEL_ENV === "production") notFound();
  const { state, art, number, action, both, theme, look } = await searchParams;
  const s: PreviewState = (PREVIEW_STATES as readonly string[]).includes(state ?? "") ? state as PreviewState : "scan";
  // For the device screens: &art=a|b|c picks the picture, &number=1 shows the number, &action=compare
  // is the 1.2 wording, &both=1 gives the account the other device too. &theme=leaf shows the card on
  // the site's dark theme, which /connect itself never uses.
  const card = (
    <ConnectCard look={lookFor(look, false)} label={{ claimed_name: "Claude", redirect_host: "claude.ai", loopback: false }}>
      <Preview
        state={s} art={art === "a" || art === "c" ? art : "b"} number={number === "1" ? "42" : null}
        action={action === "compare" ? "compare" : "type"} both={both === "1"}
      />
    </ConnectCard>
  );
  return theme === "leaf" ? <div data-theme="leaf" className={styles.leafPreview}>{card}</div> : card;
}
