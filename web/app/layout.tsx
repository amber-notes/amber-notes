import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./site.css";
import SiteChrome, { themeScript } from "./SiteChrome";
import { latestVersion } from "@/lib/changelog";
import { repoStats } from "@/lib/github";

export const metadata: Metadata = {
  metadataBase: new URL("https://ambernotes.app"),
  title: "Amber Notes",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
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
