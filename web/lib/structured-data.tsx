import { GITHUB_URL } from "./github";
import { APP_STORE_LIVE, APP_STORE_URL, MAKER_GITHUB, SITE_NAME, SITE_URL, X_URL } from "./site";

/// schema.org JSON-LD for search engines. Only facts the site states elsewhere: the app is free,
/// runs on macOS 26 and iOS, and is made by one person. No ratings or reviews, because there are none yet.

type Thing = Record<string, unknown>;

const PERSON_ID = `${SITE_URL}/#maker`;
const APP_ID = `${SITE_URL}/#app`;

export const maker: Thing = {
  "@type": "Person",
  "@id": PERSON_ID,
  name: "Emil Wagman",
  url: X_URL,
  sameAs: [X_URL, MAKER_GITHUB],
};

export const website: Thing = {
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  name: SITE_NAME,
  url: SITE_URL,
  inLanguage: "en",
  publisher: { "@id": PERSON_ID },
};

export function app(version: string | null): Thing {
  return {
    "@type": "SoftwareApplication",
    "@id": APP_ID,
    name: SITE_NAME,
    url: SITE_URL,
    description:
      "A simple notes app for iPhone and Mac that ChatGPT, Claude, Claude Code and Codex can read and edit, with your approval. Imports your Apple Notes, syncs in about a second, keeps every version an AI changes, and stores notes as markdown.",
    applicationCategory: "ProductivityApplication",
    operatingSystem: "iOS, macOS",
    softwareRequirements: "macOS 26 or later; iOS 26 or later",
    ...(version ? { softwareVersion: version } : {}),
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    isAccessibleForFree: true,
    downloadUrl: `${SITE_URL}/downloads/Amber-Notes.dmg`,
    installUrl: APP_STORE_LIVE ? APP_STORE_URL : `${SITE_URL}/download`,
    image: `${SITE_URL}/mark.png`,
    screenshot: `${SITE_URL}/demo/lisbon/lisbon-1-faded.webp`,
    featureList: [
      "Connect ChatGPT, Claude, Claude Code or Codex over MCP",
      "Approve each AI connection, read-only or read and edit",
      "Version history for every change an AI makes",
      "Import from Apple Notes",
      "Sync between iPhone and Mac",
      "Markdown underneath, formatted on screen",
      "Checklists, tables, photos and files",
      "Share a note as a web page",
    ],
    license: `${GITHUB_URL}/blob/main/LICENSE`,
    sameAs: [GITHUB_URL],
    author: { "@id": PERSON_ID },
    publisher: { "@id": PERSON_ID },
  };
}

export function faqPage(items: { q: string; a: string[] }[], path: string): Thing {
  return {
    "@type": "FAQPage",
    "@id": `${SITE_URL}${path}#faq`,
    url: `${SITE_URL}${path}`,
    mainEntity: items.map((it) => ({
      "@type": "Question",
      name: it.q,
      acceptedAnswer: { "@type": "Answer", text: it.a.join("\n\n") },
    })),
  };
}

/// A graph of things as one <script type="application/ld+json">. "<" is escaped so note-like
/// text can never close the script element.
export function JsonLd({ graph }: { graph: Thing[] }) {
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
