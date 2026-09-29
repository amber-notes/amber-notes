"use client";

import { usePathname, useRouter } from "next/navigation";

/// Starts the Mac download right away, then shows the install steps on /download.
export default function DownloadLink({ className, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const router = useRouter();
  const path = usePathname();
  return (
    <a {...rest} className={className} href="/downloads/Amber-Notes.dmg" download="Amber-Notes.dmg"
      onClick={() => { if (path !== "/download") window.setTimeout(() => router.push("/download"), 300); }}>
      {children}
    </a>
  );
}
