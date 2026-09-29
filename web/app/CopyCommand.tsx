"use client";

import { useState } from "react";
import styles from "./home.module.css";

/// A command in a code box with a Copy button that says "Copied" for a moment.
export default function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={styles.cmd}>
      <code>{command}</code>
      <button type="button" className={styles.copy} onClick={async () => {
        try { await navigator.clipboard.writeText(command); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch {}
      }}>{copied ? "Copied" : "Copy"}</button>
      <span className={styles.live} aria-live="polite">{copied ? "Command copied" : ""}</span>
    </div>
  );
}
