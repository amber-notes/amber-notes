"use client";

import { useEffect } from "react";

/// Tries the app's own scheme once when the page loads. `href` is built on the server from a
/// checked slug, never from anything else in the address.
export default function OpenApp({ href }: { href: string }) {
  useEffect(() => {
    if (/^ambernotes:\/\/(template|copy)\/[A-Za-z0-9_-]{1,64}$/.test(href)) window.location.href = href;
  }, [href]);
  return null;
}
