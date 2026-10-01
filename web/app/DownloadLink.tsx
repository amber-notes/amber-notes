"use client";

import { usePathname, useRouter } from "next/navigation";
import { MAC_DOWNLOAD_PATH } from "@/lib/downloads";

/// Starts the Mac download right away (counted, lib/downloads.ts), then shows the install steps on /download.
export default function DownloadLink({ className, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const router = useRouter();
  const path = usePathname();
  return (
    <a {...rest} className={className} href={MAC_DOWNLOAD_PATH} download="Amber-Notes.dmg"
      onClick={() => { if (path !== "/download") window.setTimeout(() => router.push("/download"), 300); }}>
      {children}
    </a>
  );
}
