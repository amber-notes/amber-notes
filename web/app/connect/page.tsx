import type { Metadata } from "next";
import { problemText, validRequest } from "@/lib/connect";
import ConnectFlow from "./ConnectFlow";
import styles from "./connect.module.css";

// Where an AI's sign-in lands (the MCP server's /authorize sends it here). See lib/connect.ts.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connect to Amber Notes", robots: { index: false, follow: false } };

export default async function Connect({ searchParams }: { searchParams: Promise<{ request?: string; code?: string; error?: string; problem?: string }> }) {
  const { request, code, error, problem } = await searchParams;
  const supabaseURL = process.env.SUPABASE_URL ?? "";
  const anonKey = process.env.SUPABASE_ANON_KEY ?? "";
  if (!validRequest(request) || !supabaseURL || !anonKey) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <img className={styles.mark} src="/mark-256.png" alt="" width={56} height={56} />
          <h1 className={styles.title}>{problem ? "Couldn't connect" : "This link isn't complete"}</h1>
          <p className={styles.lede}>{problemText(problem)}</p>
        </div>
      </main>
    );
  }
  return <ConnectFlow requestId={request} supabaseURL={supabaseURL} anonKey={anonKey} authCode={code} authError={error} />;
}
