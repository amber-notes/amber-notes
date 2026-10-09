import type { Metadata } from "next";
import { MCP_URL, WHAT_IT_IS } from "@/lib/facts";
import { OLD_NAME, SITE_NAME, pageMetadata } from "@/lib/site";
import { JsonLd, breadcrumbs, renamed } from "@/lib/structured-data";
import styles from "../home.module.css";
import s from "./renamed.module.css";

// Where a search for the old name lands: Amber Notes is Pinto Notes now, and what that means for
// someone who already uses it. ambernotes.app/amber-notes and /ambernotes arrive here too.

const TITLE = `${OLD_NAME} is now ${SITE_NAME}`;
const DESCRIPTION = `${OLD_NAME}, the notes app ChatGPT and Claude can read and edit, has been called ${SITE_NAME} since October 2026. Same app, same notes, at pintonotes.com.`;
const PATH = "/amber-notes";

export const dynamic = "force-static";
export const metadata: Metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: PATH });

const rise = (i: number) => ({ className: "rise", style: { "--i": i } as React.CSSProperties });

export default function Renamed() {
  return (
    <div className={styles.main}>
      <JsonLd graph={[renamed({ title: TITLE, description: DESCRIPTION, path: PATH }), breadcrumbs([{ name: SITE_NAME, path: "/" }, { name: TITLE, path: PATH }])]} />
      <section className={styles.log}>
        <div className={styles.logHead}>
          <h1 className={`${styles.h2} rise`} style={{ "--i": 0 } as React.CSSProperties}>{TITLE}</h1>
          <p className={`${styles.lede} rise`} style={{ "--i": 1 } as React.CSSProperties}>Same app, same notes, new name. It was called {OLD_NAME} until October 2026.</p>
        </div>
        <div className={s.body}>
          <section {...rise(2)}>
            <h2>What changed</h2>
            <p>The name, and the website&apos;s address. The site is at pintonotes.com, and every ambernotes.app link opens the same page here.</p>
          </section>
          <section {...rise(3)}>
            <h2>What stayed the same</h2>
            <p>Your notes, your account and the encryption. ChatGPT, Claude and the other AI apps you connected keep working at {MCP_URL}, and that address stays. There&apos;s nothing to reconnect and nothing you need to do.</p>
            <p>The app on your Mac shows the new name after its next update. Until then it still says {OLD_NAME}, and so do a few listings, such as Claude&apos;s connector directory. It&apos;s the same app.</p>
          </section>
          <section {...rise(4)}>
            <h2>Why the new name</h2>
            <p>Another product already used the name {OLD_NAME}, a meeting transcription service from a different company. Two apps with one name is confusing for everyone, so I changed mine.</p>
          </section>
          <section {...rise(5)}>
            <h2>New here?</h2>
            <p>{WHAT_IT_IS} <a href="/">See what it does</a>, <a href="/download">download it for Mac</a>, or read the <a href="/help">help page</a>.</p>
          </section>
        </div>
      </section>
    </div>
  );
}
