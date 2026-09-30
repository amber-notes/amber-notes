/// Every guide under /guides, in the order the index lists them. `draft` guides are noindex and
/// stay out of the navigation and sitemap until they're approved. `updated` is the day the guide
/// was last checked against the app, shown on the page and used as its dateModified.
export type Guide = { slug: string; title: string; description: string; updated: string; draft: boolean };

export const guides: Guide[] = [
  {
    slug: "connect-chatgpt-to-your-notes",
    title: "How to connect ChatGPT to your notes",
    description: "Let ChatGPT or Claude read and update your notes on iPhone and Mac. What you need, the steps, and how you stay in control.",
    updated: "2026-09-30",
    draft: false,
  },
  {
    slug: "claude-and-apple-notes",
    title: "Can Claude read your Apple Notes?",
    description: "What works today on a Mac, what doesn't work on iPhone or the web, and the options side by side.",
    updated: "2026-09-30",
    draft: false,
  },
  {
    slug: "chatgpt-and-apple-notes",
    title: "How to use ChatGPT with Apple Notes",
    description: "The three ways ChatGPT can work with Apple Notes today, what each can and can't do, and when a different notes app makes sense.",
    updated: "2026-09-30",
    draft: true,
  },
  {
    slug: "notes-apps-with-mcp",
    title: "Notes apps with an MCP server, compared",
    description: "Which notes apps ChatGPT and Claude can read and edit through MCP, whether that works away from your Mac, and what to check before you pick one.",
    updated: "2026-09-30",
    draft: false,
  },
  {
    slug: "notes-in-claude-code-and-codex",
    title: "Use your notes from Claude Code and Codex",
    description: "Add Amber Notes to Claude Code or Codex in one step, and let your coding agent read and write your notes.",
    updated: "2026-09-30",
    draft: false,
  },
  {
    slug: "move-from-apple-notes",
    title: "How to move from Apple Notes to Amber Notes",
    description: "Import all your Apple Notes on your Mac, with folders, checklists and tables. Apple Notes stays untouched.",
    updated: "2026-09-30",
    draft: false,
  },
  {
    slug: "amber-notes-vs-apple-notes",
    title: "Amber Notes vs Apple Notes",
    description: "What Amber Notes adds, what Apple Notes still does better, and who each one is for.",
    updated: "2026-09-30",
    draft: false,
  },
  {
    slug: "mcp-server",
    title: "The Amber Notes MCP server",
    description: "The server address, how sign-in and approval work, and every tool an AI app can call.",
    updated: "2026-09-30",
    draft: false,
  },
];

export const guide = (slug: string): Guide => {
  const g = guides.find((x) => x.slug === slug);
  if (!g) throw new Error(`No guide ${slug}`);
  return g;
};

export const published = () => guides.filter((g) => !g.draft);
