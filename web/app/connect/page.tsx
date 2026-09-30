import type { Metadata } from "next";
import { headers } from "next/headers";
import { approveHeading, fetchLabel, functionURL, problemText, universalLink, validRequest } from "@/lib/connect";
import { upstreamHeaders } from "@/lib/mcp-proxy";
import ConnectCard from "./ConnectCard";
import styles from "./connect.module.css";

// Where an AI's sign-in lands (the MCP server's /authorize sends it here). It names who is asking
// and sends the person to Amber Notes, where they approve it. See lib/connect.ts.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connect to Amber Notes", robots: { index: false, follow: false } };

export default async function Connect({ searchParams }: { searchParams: Promise<{ request?: string; problem?: string }> }) {
  const { request, problem } = await searchParams;
  if (!validRequest(request)) {
    return (
      <ConnectCard>
        <h1 className={styles.title}>{problem ? "Couldn't connect" : "This link isn't complete"}</h1>
        <p className={styles.lede}>{problemText(problem)}</p>
      </ConnectCard>
    );
  }
  const label = await labelFor(request);
  return (
    <ConnectCard ai={label?.verified_ai}>
      <h1 className={styles.title}>{approveHeading(label)}</h1>
      <p className={styles.lede}>The app asks you to allow it, then takes you back to finish connecting.</p>
      <a className={styles.primary} href={universalLink(request)}>Open Amber Notes</a>
      <p className={styles.small}>
        Don't have Amber Notes? <a href="/download">Download it</a>, sign in, then start connecting again.
      </p>
    </ConnectCard>
  );
}

/// Who is asking, from the MCP function, as the site's proxy would ask: with the visitor's address
/// for its rate limit. Nothing when it can't say; the page then uses general words.
async function labelFor(id: string) {
  const supabase = process.env.SUPABASE_URL;
  if (!supabase) return null;
  const secret = process.env.MCP_PROXY_SECRET;
  const incoming = await headers();
  return fetchLabel(functionURL(supabase), id, secret ? upstreamHeaders(incoming, secret) : new Headers());
}
