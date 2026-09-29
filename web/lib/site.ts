import type { Metadata } from "next";

/// The site's address and the facts every page's metadata and structured data share.

export const SITE_URL = "https://ambernotes.app";
export const SITE_NAME = "Amber Notes";
export const X_URL = "https://x.com/EmilWagman";
export const X_HANDLE = "@EmilWagman";
export const MAKER_GITHUB = "https://github.com/emilwagman";

// The iPhone app. Flipping this shows the App Store button and turns on Safari's Smart App Banner.
export const APP_STORE_LIVE = false;
export const APP_STORE_ID = "6817253103";
export const APP_STORE_URL = `https://apps.apple.com/app/id${APP_STORE_ID}`;

type Page = {
  /// The <title>, as it shows in search results.
  title: string;
  /// The meta description: one or two plain sentences, under about 160 characters.
  description: string;
  /// The page's path on SITE_URL; it becomes the canonical and the Open Graph URL.
  path: string;
  /// A shorter headline for share cards, when the title carries the brand.
  shareTitle?: string;
  /// Only pages that are ready for search say true; the root layout's default is noindex.
  index?: boolean;
};

/// Title, description, canonical, robots, Open Graph and Twitter for one page. Next.js replaces
/// (doesn't merge) openGraph and twitter between layouts and pages, so each page gets all of it.
export function pageMetadata({ title, description, path, shareTitle, index = true }: Page): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: index ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { title: shareTitle ?? title, description, url: path, siteName: SITE_NAME, type: "website", locale: "en_US" },
    twitter: { card: "summary_large_image", title: shareTitle ?? title, description, creator: X_HANDLE },
  };
}
