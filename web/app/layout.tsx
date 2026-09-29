import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./site.css";
import SiteChrome, { themeScript } from "./SiteChrome";
import { latestVersion } from "@/lib/changelog";
import { repoStats } from "@/lib/github";
import { APP_STORE_ID, APP_STORE_LIVE, SITE_NAME, SITE_URL } from "@/lib/site";

// Google Search Console and Bing Webmaster ownership by meta tag, set at build time. A DNS TXT
// record on ambernotes.app does the same without these.
const verification = {
  google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
  other: process.env.BING_SITE_VERIFICATION ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION } : undefined,
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_NAME,
  applicationName: SITE_NAME,
  // Pages that may be indexed say so themselves; everything else (shared notes, reports) is noindex.
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
  // Safari's Smart App Banner, once the iPhone app is on the App Store.
  ...(APP_STORE_LIVE ? { itunes: { appId: APP_STORE_ID } } : {}),
  verification,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1e1e1e" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const stats = await repoStats();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <SiteChrome version={latestVersion()} stars={stats?.stars ?? null}>{children}</SiteChrome>
      </body>
    </html>
  );
}
