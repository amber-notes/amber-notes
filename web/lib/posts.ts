/// Every blog post, in the order the index lists them. This is the one list: the index, the
/// sitemap, /llms.txt, "More posts" and "All posts" all read it. `draft` posts are noindex and
/// stay out of every list until they're approved.

export type Category = "Guides" | "Comparisons" | "Building Amber Notes";

/// A real capture of the app, in public/blog. `window` says whether the capture already has the
/// Mac window around it (true), or is a sheet or form that the page frames in a window (false).
export type Shot = { src: string; alt: string; width: number; height: number; window: boolean; title?: string };

export type Post = {
  slug: string;
  title: string;
  /// The meta description, for search results (under about 160 characters).
  description: string;
  /// The card text on the index: two or three lines.
  excerpt: string;
  category: Category;
  /// When it was published, and the day it was last checked against the app (ISO dates).
  date: string;
  updated: string;
  /// The capture right after the intro, on the post's ground.
  image: Shot;
  /// The card's picture: its own ground and composition, so no two posts look alike.
  cover: CoverArt;
  draft: boolean;
};

/// The ground a cover (and the post's first picture) sits on: the site's palette, the help page's
/// leaf brown, the app's dark look, or the home page's dunes.
export type Ground = "paper" | "soft" | "tint" | "amber" | "leaf" | "dark" | "dunes" | "ink" | "peach" | "cream";

/// One capture placed on a cover, in percent of the cover's width and height (it may run off an
/// edge). `frame`: a Mac title bar, a plain rounded card, nothing (a capture with its own shape),
/// or "art": App Store art of an iPhone, whose own background fades into the ground at its edges.
export type Layer = { src: string; width: number; height: number; left: number; top: number; size: number; frame: "window" | "card" | "none" | "art"; title?: string; dark?: boolean };
export type CoverArt = { ground: Ground; layers: Layer[] };

const layer = (src: string, width: number, height: number, left: number, top: number, size: number, frame: Layer["frame"], more: Partial<Layer> = {}): Layer =>
  ({ src: `/blog/${src}`, width, height, left, top, size, frame, ...more });

export const AUTHOR = { name: "Emil Wagman", avatar: "/emil-wagman.jpg" };

export const SHOTS = {
  connectChatGPT: { src: "/blog/connect-chatgpt.webp", alt: "Connect ChatGPT in Amber Notes on a Mac: a Copy Address and Open ChatGPT button, then four steps: turn on Developer mode, add Amber Notes in Plugins, paste the address and choose OAuth, then Allow.", width: 1120, height: 610, window: false, title: "Connect ChatGPT" },
  connectClaude: { src: "/blog/connect-claude.webp", alt: "Connect Claude in Amber Notes on a Mac: an Add to Claude button, a note that it works on every Claude plan, then the steps: choose Add, then Connect, then Allow.", width: 1120, height: 590, window: false, title: "Connect Claude" },
  consent: { src: "/blog/consent.webp", alt: "Amber Notes asking \"Allow ChatGPT to use your notes?\" with a choice of Read and Edit or Read Only, and Allow and Don't Allow buttons.", width: 840, height: 700, window: false, title: "Amber Notes" },
  connectList: { src: "/blog/connect-ai.webp", alt: "Settings in Amber Notes on a Mac: Connect an AI lists ChatGPT, Claude, Claude Code and Codex, with what's connected below.", width: 1040, height: 720, window: false, title: "Settings" },
  importSheet: { src: "/blog/import-sheet.webp", alt: "The Import from Apple Notes sheet in Amber Notes on a Mac: notes picked, Keep Apple Notes folders and Also bring over pinned notes ticked, and an Import 1,284 Notes button.", width: 1980, height: 1800, window: true },
  aiEdit: { src: "/blog/ai-edit.webp", alt: "A Groceries note in Amber Notes on a Mac. The five lines ChatGPT just added are tinted, and a bar at the bottom says ChatGPT changed 5 lines, with Undo.", width: 1260, height: 1520, window: false, title: "Groceries" },
  history: { src: "/blog/history.webp", alt: "Version history for a Groceries note in Amber Notes on a Mac: versions by you on iPhone and Mac, ChatGPT and Claude Code, with the lines that differ tinted and a Restore This Version button.", width: 1800, height: 1200, window: false, title: "Groceries" },
  welcome: { src: "/blog/p3-welcome-pane.webp", alt: "The Welcome to Amber Notes note on a Mac: markdown that styles itself as you type, a checklist, bullets, inline code and a table.", width: 1250, height: 950, window: false, title: "Welcome to Amber Notes" },
  phoneChanges: { src: "/blog/p3-phone-changes.webp", alt: "Amber Notes on iPhone: the note list with Groceries marked Edited by ChatGPT, Lisbon Edited by Claude and Standup notes Edited by Claude Code.", width: 440, height: 793, window: true },
  historyBurst: { src: "/blog/p3-history-burst.webp", alt: "Version history for a Groceries note on a Mac: versions by you on iPhone and Mac, ChatGPT and Claude Code, with the lines that differ tinted and a Restore This Version button.", width: 1800, height: 1200, window: false, title: "Groceries" },
} satisfies Record<string, Shot>;

export const posts: Post[] = [
  {
    slug: "connect-chatgpt-to-your-notes",
    title: "How to connect ChatGPT to your notes",
    description: "Let ChatGPT or Claude read and update your notes on iPhone and Mac. What you need, the steps, and how you stay in control.",
    excerpt: "Ask ChatGPT to add to a list or tidy a note, and the change lands in your notes. The steps for ChatGPT and Claude, and how you stay in control.",
    category: "Guides",
    date: "2026-09-30",
    updated: "2026-09-30",
    image: SHOTS.connectChatGPT,
    cover: { ground: "paper", layers: [layer("cover-ai-rows.webp", 920, 765, 9, 12, 64, "card"), layer("cover-ai-pill.webp", 590, 156, 40, 64, 54, "none")] },
    draft: false,
  },
  {
    slug: "claude-and-apple-notes",
    title: "Can Claude read your Apple Notes?",
    description: "What works today on a Mac, what doesn't work on iPhone or the web, and the options side by side.",
    excerpt: "On a Mac, yes. On iPhone and in the browser, no. Why it depends on where you use Claude, and what each option can and can't do.",
    category: "Guides",
    date: "2026-09-30",
    updated: "2026-09-30",
    image: SHOTS.connectClaude,
    cover: { ground: "leaf", layers: [layer("cover-phone-claude.webp", 440, 453, 13, 10, 74, "art")] },
    draft: false,
  },
  {
    slug: "notes-apps-with-mcp",
    title: "Notes apps with an MCP server, compared",
    description: "Which notes apps ChatGPT and Claude can read and edit through MCP, whether that works away from your Mac, and what to check before you pick one.",
    excerpt: "Notion, Evernote, Bear, Obsidian, Apple Notes and more: which ones your AI can reach from your phone, and what happens when it gets an edit wrong.",
    category: "Comparisons",
    date: "2026-09-30",
    updated: "2026-09-30",
    image: SHOTS.aiEdit,
    cover: { ground: "dunes", layers: [layer("history.webp", 1800, 1200, 6, 12, 66, "window", { title: "Groceries" }), layer("cover-consent-choice.webp", 840, 490, 48, 40, 46, "card")] },
    draft: false,
  },
  {
    slug: "move-from-apple-notes",
    title: "How to move from Apple Notes to Amber Notes",
    description: "Import all your Apple Notes on your Mac, with folders, checklists and tables. Apple Notes stays untouched.",
    excerpt: "Bring every note over in one go on your Mac, folders and pins included. Nothing in Apple Notes changes, so you can take your time.",
    category: "Guides",
    date: "2026-09-30",
    updated: "2026-09-30",
    image: SHOTS.importSheet,
    cover: { ground: "soft", layers: [layer("cover-import-head.webp", 1065, 560, 8, 9, 84, "card"), layer("cover-import-progress.webp", 1065, 110, 22, 77, 70, "card")] },
    draft: false,
  },
  {
    slug: "notes-in-claude-code-and-codex",
    title: "Use your notes from Claude Code and Codex",
    description: "Add Amber Notes to Claude Code or Codex in one step, and let your coding agent read and write your notes.",
    excerpt: "Let your coding agent write the standup or keep a work log, in the same notes you read on your phone. One command for Claude Code, a few lines for Codex.",
    category: "Guides",
    date: "2026-09-30",
    updated: "2026-09-30",
    image: SHOTS.connectList,
    cover: { ground: "dark", layers: [layer("cover-connect-ai-dark.webp", 1040, 720, 14, 12, 72, "window", { title: "Settings", dark: true })] },
    draft: false,
  },
  {
    slug: "amber-notes-vs-apple-notes",
    title: "Amber Notes vs Apple Notes",
    description: "What Amber Notes adds, what Apple Notes still does better, and who each one is for.",
    excerpt: "Amber Notes is built to feel like Apple Notes, with a few things it always missed. Where they differ, including what Apple Notes still does better.",
    category: "Comparisons",
    date: "2026-09-30",
    updated: "2026-09-30",
    image: SHOTS.history,
    cover: { ground: "tint", layers: [layer("cover-phone-versions.webp", 400, 793, 33, 9, 36, "art")] },
    draft: false,
  },
  {
    slug: "mcp-server",
    title: "The Amber Notes MCP server",
    description: "The server address, how sign-in and approval work, and every tool an AI app can call.",
    excerpt: "For developers and curious people: the address, how an AI app signs in and gets approved, and every tool it can call.",
    category: "Guides",
    date: "2026-09-30",
    updated: "2026-09-30",
    image: SHOTS.consent,
    cover: { ground: "amber", layers: [layer("cover-consent-choice.webp", 840, 490, 13, 16, 74, "card")] },
    draft: false,
  },
  {
    slug: "apple-notes-api",
    title: "Apple Notes API: what exists and what to use instead",
    description: "Apple Notes has no public API. What you can use on a Mac and iPhone (AppleScript, Shortcuts, export), what each can do, and when to use a notes app with an API.",
    excerpt: "Apple Notes has no public API. What you can do with AppleScript and Shortcuts, what you can't, and what to use when you need more.",
    category: "Guides",
    date: "2026-09-30",
    updated: "2026-09-30",
    image: SHOTS.welcome,
    cover: { ground: "ink", layers: [layer("p3-welcome-detail.webp", 1000, 330, 8, 24, 84, "card")] },
    draft: false,
  },
  {
    slug: "notes-apps-that-work-with-chatgpt",
    title: "Notes apps that work with ChatGPT",
    description: "Which notes apps ChatGPT can search and write to in 2026, compared fairly: Notion, OneNote, Evernote, Apple Notes, Google Keep, Amber Notes and more.",
    excerpt: "\u201cWorks with ChatGPT\u201d can mean reading the note you have open, or searching and editing all of them. The main notes apps, compared.",
    category: "Comparisons",
    date: "2026-09-30",
    updated: "2026-09-30",
    image: SHOTS.phoneChanges,
    cover: { ground: "peach", layers: [layer("p3-phone-chatgpt-card.webp", 480, 330, 10, 12, 80, "card")] },
    draft: false,
  },
  {
    slug: "best-notes-app-for-ai-agents",
    title: "The best notes app for AI agents",
    description: "What an AI agent needs from a notes app: remote MCP, precise writes, undo and history, approval, and apps you read on. How the options compare.",
    excerpt: "Remote MCP, precise writes, undo, approval and a phone app to read the results: the criteria that matter, and how the options compare.",
    category: "Comparisons",
    date: "2026-09-30",
    updated: "2026-09-30",
    image: SHOTS.historyBurst,
    cover: { ground: "cream", layers: [layer("p3-tracker-table.webp", 1250, 690, 9, 14, 96, "card")] },
    draft: false,
  },
  {
    slug: "chatgpt-and-apple-notes",
    title: "How to use ChatGPT with Apple Notes",
    description: "The three ways ChatGPT can work with Apple Notes today, what each can and can't do, and when a different notes app makes sense.",
    excerpt: "ChatGPT can help with the note in front of you, but it can't search your notes or save to them. The three ways it works today.",
    category: "Guides",
    date: "2026-09-30",
    updated: "2026-09-30",
    image: SHOTS.aiEdit,
    cover: { ground: "paper", layers: [layer("ai-edit.webp", 1260, 1520, 20, 10, 60, "window", { title: "Groceries" })] },
    draft: true,
  },
];

export const post = (slug: string): Post => {
  const p = posts.find((x) => x.slug === slug);
  if (!p) throw new Error(`No post ${slug}`);
  return p;
};

export const published = () => posts.filter((p) => !p.draft);

/// Categories that have at least one published post, in a fixed order.
export const categories = (): Category[] =>
  (["Guides", "Comparisons", "Building Amber Notes"] as Category[]).filter((c) => published().some((p) => p.category === c));

export const categoryAnchor = (c: Category) => c.toLowerCase().replace(/\s+/g, "-");

/// Two other published posts to read next: the same category first, then the rest, in list order.
export function morePosts(slug: string, n = 2): Post[] {
  const me = post(slug);
  const others = published().filter((p) => p.slug !== slug);
  return [...others.filter((p) => p.category === me.category), ...others.filter((p) => p.category !== me.category)].slice(0, n);
}
