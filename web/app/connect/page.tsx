import type { Metadata } from "next";
import { headers } from "next/headers";
import { fetchLabel, functionURL, problemText, validRequest } from "@/lib/connect";
import { upstreamHeaders } from "@/lib/mcp-proxy";
import ConnectCard from "./ConnectCard";
import ConnectFlow from "./ConnectFlow";
import { designFrom } from "./ConnectScreen";
import styles from "./connect.module.css";

// Where an AI's sign-in lands (the MCP server's /authorize sends it here). It says what the app calls itself;
// you approve on your iPhone or Mac, or here with your recovery key. See lib/connect.ts.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connect to Amber Notes", robots: { index: false, follow: false } };

export default async function Connect({ searchParams }: { searchParams: Promise<{ request?: string; problem?: string; recover?: string; code?: string; error?: string; design?: string }> }) {
  const { request, problem, recover, code, error, design } = await searchParams;
  const supabaseURL = process.env.SUPABASE_URL ?? "";
  const anonKey = process.env.SUPABASE_ANON_KEY ?? "";
  if (validRequest(request) && (!supabaseURL || !anonKey)) {
    console.error("/connect: SUPABASE_URL or SUPABASE_ANON_KEY is not set");
    return (
      <ConnectCard>
        <h1 className={styles.title}>Couldn't connect</h1>
        <p className={styles.lede}>Connecting isn't available right now. Try again in a few minutes.</p>
      </ConnectCard>
    );
  }
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
    <ConnectCard>
      <ConnectFlow
        requestId={request.toLowerCase()} supabaseURL={supabaseURL} anonKey={anonKey} label={label}
        recover={recover === "1"} authCode={typeof code === "string" ? code : undefined} authError={typeof error === "string" ? error : undefined}
        design={process.env.VERCEL_ENV !== "production" && typeof design === "string" ? designFrom(design) : "current"}
      />
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
