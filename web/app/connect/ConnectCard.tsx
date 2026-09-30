import styles from "./connect.module.css";

/// The one card both connect pages show: Amber Notes' mark, then whatever the page says. No other
/// app's mark: nothing on these pages vouches for who is asking.
export default function ConnectCard({ children }: { children: React.ReactNode }) {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.marks} aria-hidden="true">
          <img className={styles.mark} src="/mark-256.png" alt="" width={56} height={56} />
        </div>
        {children}
      </div>
      <p className={styles.foot}>
        <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/support">Support</a>
      </p>
    </main>
  );
}
