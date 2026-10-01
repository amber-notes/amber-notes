import { GITHUB_URL } from "./github";
import { APP_STORE_LIVE, APP_STORE_URL, INCREDIBLE_URL, MAKER_GITHUB, MAKER_URL, SITE_NAME, SITE_URL, X_URL } from "./site";

/// schema.org JSON-LD for search engines. Only facts the site states elsewhere: the app is free,
/// runs on macOS 26 and iOS, and is made by one person. No ratings or reviews, because there are none yet.

type Thing = Record<string, unknown>;

const PERSON_ID = `${SITE_URL}/#maker`;
const APP_ID = `${SITE_URL}/#app`;
const ORG_ID = `${SITE_URL}/#organization`;

/// Where else Amber Notes is, so search engines don't mix it up with other apps of a similar name.
const SAME_AS = [GITHUB_URL, ...(APP_STORE_LIVE ? [APP_STORE_URL] : [])];

/// The company the maker works at, which also makes the Incredible AI assistant.
export const incredible: Thing = {
  "@type": "Organization",
  "@id": `${INCREDIBLE_URL}/#organization`,
  name: "Incredible",
  url: INCREDIBLE_URL,
};

export const maker: Thing = {
  "@type": "Person",
  "@id": PERSON_ID,
  name: "Emil Wagman",
  url: MAKER_URL,
  image: `${SITE_URL}/emil-wagman.jpg`,
  sameAs: [MAKER_URL, X_URL, MAKER_GITHUB],
  worksFor: { "@id": incredible["@id"] },
};

/// Amber Notes as the publisher of the site and the app, founded by its maker.
export const organization: Thing = {
  "@type": "Organization",
  "@id": ORG_ID,
  name: SITE_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/mark.png`,
  description: "Makers of Amber Notes, the free, open-source notes app for iPhone and Mac that ChatGPT and Claude can use.",
  founder: { "@id": PERSON_ID },
  sameAs: SAME_AS,
};

export const website: Thing = {
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  name: SITE_NAME,
  url: SITE_URL,
  inLanguage: "en",
  publisher: { "@id": ORG_ID },
};

export function app(version: string | null): Thing {
  return {
    "@type": "SoftwareApplication",
    "@id": APP_ID,
    name: SITE_NAME,
    url: SITE_URL,
    description:
      "A simple notes app for iPhone and Mac that ChatGPT, Claude, Claude Code, Codex and Incredible can read and edit, with your approval. Imports your Apple Notes, syncs in about a second, keeps every version an AI changes, and stores notes as markdown.",
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
      "Connect ChatGPT, Claude, Claude Code, Codex or Incredible over MCP",
      "Approve each AI connection, read-only or read and edit",
      "Version history for every change an AI makes",
      "Import from Apple Notes",
      "Sync between iPhone and Mac",
      "Markdown underneath, formatted on screen",
      "Checklists, tables, photos and files",
      "Share a note as a web page",
    ],
    license: `${GITHUB_URL}/blob/main/LICENSE`,
    sameAs: SAME_AS,
    author: { "@id": PERSON_ID },
    publisher: { "@id": ORG_ID },
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

/// A blog post as an Article, written by the maker and published by Amber Notes.
export function article({ title, description, path, date, updated, image }: { title: string; description: string; path: string; date: string; updated: string; image?: string }): Thing {
  return {
    "@type": "Article",
    "@id": `${SITE_URL}${path}#article`,
    headline: title,
    description,
    url: `${SITE_URL}${path}`,
    mainEntityOfPage: `${SITE_URL}${path}`,
    inLanguage: "en",
    datePublished: date,
    dateModified: updated,
    image: `${SITE_URL}${image ?? "/mark.png"}`,
    author: { "@id": PERSON_ID },
    publisher: { "@id": ORG_ID },
    about: { "@id": APP_ID },
  };
}

/// Where a page sits: each step a name and a path, the last one the page itself.
export function breadcrumbs(steps: { name: string; path: string }[]): Thing {
  return {
    "@type": "BreadcrumbList",
    itemListElement: steps.map((s, i) => ({ "@type": "ListItem", position: i + 1, name: s.name, item: `${SITE_URL}${s.path}` })),
  };
}

/// A template: a note structure and the prompt that fills it in, free to use, made by the maker.
export function templateWork(t: { slug: string; title: string; description: string; category: string; audience: string; updated: string; note: string }): Thing {
  const url = `${SITE_URL}/templates/${t.slug}`;
  return {
    "@type": "CreativeWork",
    "@id": `${url}#template`,
    name: `${t.title} template`,
    description: t.description,
    url,
    genre: t.category,
    audience: { "@type": "Audience", audienceType: t.audience },
    inLanguage: "en",
    dateModified: t.updated,
    isAccessibleForFree: true,
    encodingFormat: "text/markdown",
    text: t.note,
    author: { "@id": PERSON_ID },
    publisher: { "@id": ORG_ID },
    isPartOf: { "@id": `${SITE_URL}/templates#library` },
    about: { "@id": APP_ID },
  };
}

/// How to use a template: add it, copy the prompt, talk to your AI.
export function templateHowTo(t: { slug: string; title: string }, steps: { name: string; text: string }[]): Thing {
  const url = `${SITE_URL}/templates/${t.slug}`;
  return {
    "@type": "HowTo",
    "@id": `${url}#howto`,
    name: `How to use the ${t.title.toLowerCase()} template with ChatGPT or Claude`,
    url,
    tool: [{ "@type": "HowToTool", name: "Amber Notes" }, { "@type": "HowToTool", name: "ChatGPT, Claude or Claude Code" }],
    step: steps.map((st, i) => ({ "@type": "HowToStep", position: i + 1, name: st.name, text: st.text, url: `${url}#step-${i + 1}` })),
  };
}

/// The gallery: a page that lists every template.
export function templateLibrary(items: { slug: string; title: string }[]): Thing {
  return {
    "@type": "CollectionPage",
    "@id": `${SITE_URL}/templates#library`,
    name: "Amber Notes templates",
    url: `${SITE_URL}/templates`,
    inLanguage: "en",
    publisher: { "@id": ORG_ID },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: items.length,
      itemListElement: items.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.title, url: `${SITE_URL}/templates/${t.slug}` })),
    },
  };
}

/// A graph of things as one <script type="application/ld+json">. "<" is escaped so note-like
/// text can never close the script element.
export function JsonLd({ graph }: { graph: Thing[] }) {
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
