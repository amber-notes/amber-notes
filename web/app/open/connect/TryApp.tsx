"use client";

import { useEffect } from "react";

/// Tries the app's own scheme once when the page loads. `href` is built on the server from a
/// checked request id, never from anything else in the address.
export default function TryApp({ href }: { href: string }) {
  useEffect(() => {
    if (href.startsWith("ambernotes://connect?request=")) window.location.href = href;
  }, [href]);
  return null;
}
