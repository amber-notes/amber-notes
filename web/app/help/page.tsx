import type { Metadata } from "next";
import styles from "../home.module.css";
import f from "./faq.module.css";
import Faq from "./Faq";
import { FAQ } from "./questions";
import { GITHUB_URL } from "@/lib/github";

export const dynamic = "force-static";
export const metadata: Metadata = {
  title: "Help · Amber Notes",
  description: "Answers to common questions about Amber Notes, and how to reach me.",
  robots: { index: true, follow: true },
  alternates: { canonical: "/help" },
};

const rise = (i: number) => ({ className: "rise", style: { "--i": i } as React.CSSProperties });

export default function Help() {
  return (
    <div className={styles.main}>
      <section className={styles.log}>
        <div className={styles.logHead}>
          <h1 className={`${styles.h2} rise`} style={{ "--i": 0 } as React.CSSProperties}>Help</h1>
          <p className={`${styles.lede} rise`} style={{ "--i": 1 } as React.CSSProperties}>Answers to common questions, and how to reach me.</p>
        </div>
        <div {...rise(2)}><Faq items={FAQ} /></div>
        <div {...rise(3)}>
          <h2 className={f.h3}>Still stuck?</h2>
          <div className={f.contact}>
            <a href="https://x.com/EmilWagman" rel="noopener">
              <strong>Message me on X</strong>
              <span>@EmilWagman. I usually answer within a day.</span>
            </a>
            <a href={`${GITHUB_URL}/issues/new/choose`}>
              <strong>Report a bug on GitHub</strong>
              <span>Say what happened and what you expected.</span>
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
