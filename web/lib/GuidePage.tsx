import styles from "./legal.module.css";

/// A guide (/guides/*): the legal pages' centred column and prose styles, a headline and a lede.
export function GuidePage({ title, lede, children }: { title: string; lede: string; children: React.ReactNode }) {
  return (
    <div className={styles.main}>
      <div className={styles.col}>
        <header className={`${styles.head} rise`} style={{ "--i": 0 } as React.CSSProperties}>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.updated}>{lede}</p>
        </header>
        <article className={`${styles.article} rise`} style={{ "--i": 1 } as React.CSSProperties}>{children}</article>
      </div>
    </div>
  );
}
