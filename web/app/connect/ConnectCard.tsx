import { AIGlyph } from "@/lib/ai-glyphs";
import styles from "./connect.module.css";

/// The one card both connect pages show: the AI's mark next to the app's when the server vouches
/// for it, then whatever the page says.
export default function ConnectCard({ ai, children }: { ai?: "ChatGPT" | "Claude" | null; children: React.ReactNode }) {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.marks} aria-hidden="true">
          {ai && (
            <>
              <span className={styles.tile}>
                <AIGlyph name={ai === "Claude" ? "claude" : "openai"} size={30} color={ai === "Claude" ? "#d97757" : "#111"} />
              </span>
              <LinkGlyph />
            </>
          )}
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

function LinkGlyph() {
  return (
    <svg className={styles.link2} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
    </svg>
  );
}
