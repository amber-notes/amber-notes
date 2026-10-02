import { notFound } from "next/navigation";

/// The Dev-only preview pages (/n/preview, /open/copy/preview, /dev/account) exist on local and preview
/// builds only. On the production site they are not found; they are also noindex (next.config.ts)
/// and never in the sitemap.
export const DEV_ONLY_PATHS = ["/n/preview", "/open/copy/preview", "/dev/account"] as const;

export function devOnly(): void {
  if (process.env.VERCEL_ENV === "production") notFound();
}
