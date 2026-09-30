/// Every guide under /guides, in the order the index lists them. `draft` guides are noindex and
/// stay out of the navigation and sitemap until they're approved.
export type Guide = { slug: string; title: string; description: string; draft: boolean };

export const guides: Guide[] = [
  {
    slug: "connect-chatgpt-to-your-notes",
    title: "How to connect ChatGPT to your notes",
    description: "Let ChatGPT or Claude read and update your notes on iPhone and Mac. What you need, the steps, and how you stay in control.",
    draft: true,
  },
  {
    slug: "move-from-apple-notes",
    title: "How to move from Apple Notes to Amber Notes",
    description: "Import all your Apple Notes on your Mac, with folders, checklists and tables. Apple Notes stays untouched.",
    draft: true,
  },
  {
    slug: "amber-notes-vs-apple-notes",
    title: "Amber Notes vs Apple Notes",
    description: "What Amber Notes adds, what Apple Notes still does better, and who each one is for.",
    draft: true,
  },
];
