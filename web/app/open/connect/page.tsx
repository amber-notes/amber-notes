import type { Metadata } from "next";
import { appLink, problemText, validRequest } from "@/lib/connect";
import ConnectCard from "../../connect/ConnectCard";
import styles from "../../connect/connect.module.css";
import TryApp from "./TryApp";

// The universal link's page (https://ambernotes.app/open/connect?request=<id>). Where Amber Notes
// is installed, the link opens it and this never loads. It loads when the link stays in the
// browser: Chrome on a Mac, or a tap on an ambernotes.app link while on ambernotes.app, which Safari
// keeps in the tab, or a QR code from /connect scanned on a phone without the app. Then it tries the
// app's own scheme once, with a button for a second try; a scanned code's #s=…&k=… goes along.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Open Pinto Notes", robots: { index: false, follow: false } };

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
      <h1 className={styles.title}>Opening Pinto Notes</h1>
      <p className={styles.lede}>Choose Allow in the app to finish connecting. If it didn't open, try again.</p>
      <TryApp href={href} />
      <p className={styles.small}>
        Don't have it? <a href="/download">Get Pinto Notes</a>
      </p>
    </ConnectCard>
  );
}
