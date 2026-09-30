import type { Metadata } from "next";
import { appLink, problemText, validRequest } from "@/lib/connect";
import ConnectCard from "../../connect/ConnectCard";
import styles from "../../connect/connect.module.css";
import TryApp from "./TryApp";

// The universal link's page (https://ambernotes.app/open/connect?request=<id>). Where Amber Notes
// is installed, the link opens it and this never loads. It loads when the link stays in the
// browser: Chrome on a Mac, or a tap on an ambernotes.app link while on ambernotes.app, which Safari
// keeps in the tab. Then it tries the app's own scheme once, with a button for a second try.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Open Amber Notes", robots: { index: false, follow: false } };

export default async function OpenConnect({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const { request } = await searchParams;
  if (!validRequest(request)) {
    return (
      <ConnectCard>
        <h1 className={styles.title}>This link isn't complete</h1>
        <p className={styles.lede}>{problemText(undefined)}</p>
      </ConnectCard>
    );
  }
  const href = appLink(request);
  return (
    <ConnectCard>
      <TryApp href={href} />
      <h1 className={styles.title}>Opening Amber Notes</h1>
      <p className={styles.lede}>Choose Allow in the app to finish connecting. If it didn't open, try again.</p>
      <a className={styles.primary} href={href}>Open Amber Notes</a>
      <p className={styles.small}>
        Don't have it? <a href="/download">Download Amber Notes</a>
      </p>
    </ConnectCard>
  );
}
