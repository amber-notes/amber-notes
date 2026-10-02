import { CONNECT_LOOK, destination, type ConnectLabel, type ConnectLook } from "@/lib/connect";
import styles from "./connect.module.css";

/// The frame every connect page sits in: Amber Notes' mark, then whatever the page says. No other
/// app's mark: nothing on these pages vouches for who is asking. `look` picks one of the three
/// candidate layouts (lib/connect.ts); "b" also shows where access would go beside the form.
export default function ConnectCard({ look = CONNECT_LOOK, label = null, children }: {
  look?: ConnectLook; label?: ConnectLabel | null; children: React.ReactNode;
}) {
  const to = label?.redirect_host ? destination(label.redirect_host, label.loopback) : null;
  return (
    <main className={styles.page} data-look={look}>
      <div className={styles.shell}>
        {look === "b" && (
          <aside className={styles.side}>
            <img className={styles.mark} src="/mark-256.png" alt="" width={44} height={44} />
            <RequestPicture to={to} />
            <div className={styles.sideWords}>
              <p className={styles.sideText}>
                {to ? <><span className={styles.sideCaption}>Access goes to</span> <b className={styles.sideHost}>{to}</b></> : <b className={styles.sideHost}>An app wants to use your notes</b>}
              </p>
              <p className={styles.sideNote}>It can read your notes, and edit them if you say so. Nothing is shared until you allow it.</p>
            </div>
          </aside>
        )}
        <div className={styles.card}>
          <div className={styles.marks} aria-hidden="true">
            <img className={styles.mark} src="/mark-256.png" alt="" width={56} height={56} />
          </div>
          {children}
        </div>
      </div>
      <p className={styles.foot}>
        <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/support">Support</a>
      </p>
    </main>
  );
}

/// Your notes on one side, where access would go on the other, and a dotted line between them:
/// not joined yet. Flat cut paper, in the picture colours of DeviceLead.tsx.
function RequestPicture({ to }: { to: string | null }) {
  return (
    <svg className={`${styles.picture} ${styles.sidePicture}`} viewBox="0 0 300 150" role="presentation" focusable="false" aria-hidden="true">
      <g transform="rotate(-5 62 78)">
        <rect className={styles.pShadow} x="22" y="30" width="84" height="104" rx="12" />
        <rect className={styles.pPaper} x="18" y="24" width="84" height="104" rx="12" />
        <image href="/mark-256.png" x="28" y="34" width="20" height="20" />
        <rect className={styles.pBar} x="28" y="64" width="50" height="5" rx="2.5" />
        <rect className={styles.pBarSoft} x="28" y="76" width="62" height="5" rx="2.5" />
        <rect className={styles.pBarSoft} x="28" y="88" width="56" height="5" rx="2.5" />
        <rect className={styles.pBarSoft} x="28" y="100" width="40" height="5" rx="2.5" />
      </g>
      {[0, 1, 2, 3, 4].map((i) => <circle key={i} className={styles.pDash} cx={124 + i * 12} cy="78" r="2.6" />)}
      <rect className={styles.pShadow} x="186" y="40" width="104" height="82" rx="13" />
      <rect className={styles.pBody} x="182" y="34" width="104" height="82" rx="13" />
      <rect className={styles.pScreen} x="187" y="52" width="94" height="59" rx="8" />
      {[0, 1, 2].map((i) => <circle key={i} className={styles.pDot} cx={193 + i * 8} cy="43" r="2.3" />)}
      <rect className={styles.pPaper} x="196" y="62" width="76" height="16" rx="8" />
      <rect className={styles.pBar} x="203" y="68" width="44" height="4" rx="2" />
      <rect className={styles.pBarSoft} x="196" y="88" width="60" height="5" rx="2.5" />
      <rect className={styles.pBarSoft} x="196" y="99" width="42" height="5" rx="2.5" />
    </svg>
  );
}
