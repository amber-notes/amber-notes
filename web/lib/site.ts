import type { Metadata } from "next";

/// The site's address and the facts every page's metadata and structured data share.

export const SITE_URL = "https://pintonotes.com";
/// The site's old address, from before the rename (October 2026). It sends every page here, path for
/// path (middleware.ts), but stays the host of the app's universal links: installed apps claim only
/// ambernotes.app until a release that adds pintonotes.com is everywhere.
export const OLD_SITE_URL = "https://ambernotes.app";
export const APP_LINK_URL = OLD_SITE_URL;
export const SITE_NAME = "Pinto Notes";
export const X_URL = "https://x.com/EmilWagman";
export const X_HANDLE = "@EmilWagman";
export const LINKEDIN_URL = "https://www.linkedin.com/in/emil-wagman-52a907287/";
/// Emil's own site: where his name links, and the first place search engines should look for him.
export const MAKER_URL = "https://emilwagman.com";
export const MAKER_GITHUB = "https://github.com/emilwagman";
/// The maker's company, and its AI assistant, which can use Pinto Notes like any MCP client.
export const INCREDIBLE_URL = "https://incredible.one";

// The iPhone app. Flipping this shows the App Store button and turns on Safari's Smart App Banner.
export const APP_STORE_LIVE = false;
export const APP_STORE_ID = "6817253103";
export const APP_STORE_URL = `https://apps.apple.com/app/id${APP_STORE_ID}`;

/// The app release that opens template and shared-note links (ambernotes.app/open/template/… and
/// /open/copy/…). Until it's in the App Store, the site doesn't offer "Use this template" or "Use this
/// note": an older app opens on those links and does nothing. Flip `live` with that release.
export const APP_TEMPLATES = { version: "1.1.1", live: true } as const;

/// Where Pinto Notes runs, in a table cell: true today, and right again the day the iPhone app ships.
export const DEVICES = APP_STORE_LIVE ? "iPhone and Mac" : "Mac now; iPhone coming soon";

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
  /// Articles say so to Open Graph, with when they were published and changed.
  article?: { published: string; modified: string; author: string };
  /// The share picture (1200 × 630). Pages without their own get the site's card.
  image?: { url: string; alt: string };
};

/// The site's own share card (app/opengraph-image.tsx), for pages without one of their own.
export const DEFAULT_SHARE_IMAGE = { url: "/opengraph-image", alt: "Pinto Notes: the notes app your AI can actually use. A note open on an iPhone." };

/// Title, description, canonical, robots, Open Graph and Twitter for one page. Next.js replaces
/// (doesn't merge) openGraph and twitter between layouts and pages, so each page gets all of it.
export function pageMetadata({ title, description, path, shareTitle, index = true, article, image = DEFAULT_SHARE_IMAGE }: Page): Metadata {
  const images = [{ ...image, width: 1200, height: 630 }];
  const og = { title: shareTitle ?? title, description, url: path, siteName: SITE_NAME, locale: "en_US", images };
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: index ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: article
      ? { ...og, type: "article", publishedTime: article.published, modifiedTime: article.modified, authors: [article.author] }
      : { ...og, type: "website" },
    twitter: { card: "summary_large_image", title: shareTitle ?? title, description, creator: X_HANDLE, images },
  };
}
