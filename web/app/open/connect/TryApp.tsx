"use client";

import { useEffect, useState } from "react";
import { scanFragment } from "@/lib/connect";
import styles from "../../connect/connect.module.css";

/// The "Open Amber Notes" button, and one try of the app's own scheme when the page loads. `href`
/// is built on the server from a checked request id. A scanned QR code also carries the scan secret
/// and key fingerprint in the fragment (#s=…&k=…), which never reaches the server: it's read here,
/// and passed on only in that exact shape.
export default function TryApp({ href }: { href: string }) {
  const [target, setTarget] = useState(href);
  useEffect(() => {
    if (!href.startsWith("ambernotes://connect?request=")) return;
    const fragment = scanFragment(window.location.hash);
    const to = href + (fragment ?? "");
    setTarget(to);
    window.location.href = to;
  }, [href]);
  return <a className={styles.primary} href={target}>Open Pinto Notes</a>;
}
