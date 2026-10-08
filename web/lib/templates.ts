import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { renderNote, summary, withoutTitle } from "./render";
import { APP_LINK_URL, SITE_URL } from "./site";

/// The template library. A template is a note structure plus the instructions that let ChatGPT,
/// Claude or Claude Code fill it in through the Amber Notes MCP tools. Each one is a JSON file in
/// content/templates; ORDER is the one list the gallery, the sitemap and /llms.txt read.

export const CATEGORIES = ["Habits and health", "Work", "Learning", "Home and life"] as const;
export type Category = (typeof CATEGORIES)[number];

export const AUDIENCES = ["Personal", "Work", "Students", "Developers", "Families"] as const;
export type Audience = (typeof AUDIENCES)[number];

export const CLIENTS = [
  { id: "chatgpt", name: "ChatGPT", key: "chatgpt" },
  { id: "claude", name: "Claude", key: "claude" },
  { id: "claude-code", name: "Claude Code", key: "claudeCode" },
] as const;
export type ClientId = (typeof CLIENTS)[number]["id"];

/// One MCP tool call that turns the note toward its example; the test replays them with the
/// server's own note functions, so the example is what the tools really produce.
export type DemoCall = { tool: string; args: Record<string, unknown> };

export type Template = {
  slug: string;
  title: string;
  category: Category;
  /// Who it's for, as filters.
  audiences: Audience[];
  /// Who it's for, in one line.
  audience: string;
  /// The meta description and the page's lede: one or two sentences, 70 to 160 characters.
  description: string;
  /// The card's one line, under the title on the cover: 50 characters at most.
  tagline: string;
  /// The search title, when "<title> template for ChatGPT and Claude" isn't the best one.
  seoTitle?: string;
  /// The note holds an app (a habit tracker you tick, a budget that adds up). Set once app notes
  /// ship; the gallery then offers an Apps filter (?category=apps), which the onboarding emails link to.
  app?: boolean;
  /// The folder the app suggests for it.
  folder: string;
  /// The note itself, as Amber Notes markdown. Its first line is the title.
  note: string;
  /// What to tell the AI: one prompt, with a different one for a client where it differs.
  prompt: { default: string; chatgpt?: string; claude?: string; claudeCode?: string };
  /// A few things to ask once it's set up.
  asks: string[];
  demo: DemoCall[];
  /// The note after the demo calls: what you'll get.
  example: string;
  related: string[];
  /// The day it was last checked against the app's tools (ISO date).
  updated: string;
  /// The GitHub handle of the person who contributed it, without the @. Credited on its card and page.
  author?: string;
};

export const ORDER = [
  "habit-tracker", "meeting-notes", "daily-standup", "meal-plan", "reading-list",
  "mood-energy-log", "job-hunt", "trip-plan", "study-flashcards", "decision-log",
  "workout-log", "budget-log", "one-on-one-notes", "book-notes", "bug-triage",
  "weekly-review", "recipe-box", "content-calendar", "home-maintenance", "gift-ideas",
  "cornell-notes", "daily-journal", "grocery-list",
];

const DIR = path.join(process.cwd(), "content/templates");

let cache: Template[] | undefined;

/// Every template, in gallery order.
export function templates(): Template[] {
  cache ??= ORDER.map((slug) => JSON.parse(readFileSync(path.join(DIR, `${slug}.json`), "utf8")) as Template);
  return cache;
}

/// The files on disk, for the test that keeps ORDER complete.
export function templateFiles(): string[] {
  return readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
}

export function template(slug: string): Template | undefined {
  return templates().find((t) => t.slug === slug);
}

export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/// A GitHub handle: letters, digits and single hyphens, at most 39 characters.
export const GITHUB_HANDLE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
export const authorLink = (handle: string) => `https://github.com/${handle}`;
export const validTemplateSlug = (s: string) => s.length <= 64 && SLUG.test(s);

export const anchor = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const searchTitle = (t: Template) => t.seoTitle ?? `${t.title} template for ChatGPT and Claude`;
export const templatePath = (slug: string) => `/templates/${slug}`;
/// The universal link the app opens (https://ambernotes.app/open/template/<slug>).
export const useLink = (slug: string) => `${APP_LINK_URL}/open/template/${slug}`;
/// The same, as the site's own buttons link it: a path, so a preview or local build stays on itself.
export const usePath = (slug: string) => `/open/template/${slug}`;
export const appLink = (slug: string) => `ambernotes://template/${slug}`;

export const noteTitle = (t: Template) => t.note.split("\n")[0];

/// The prompt's first step: the AI makes the note itself (create_note, which every installed app's
/// MCP server has), so a template works without the app opening any link.
export function createStep(t: Template): string {
  return `First, look for a note called "${noteTitle(t)}" in my Pinto Notes with search_notes. If there isn't one, create it with create_note in the folder "${t.folder}", using exactly the markdown at the end of this message, the <!-- pane-table --> line included (it gives the table's columns their types).`;
}

/// The template's markdown, fenced, for the end of the prompt.
export const fencedNote = (t: Template) => "```markdown\n" + t.note.replace(/\n$/, "") + "\n```";

/// What to tell each AI, resolved: the create step, the client's own text (or the shared one), then
/// the note's markdown.
export function instructions(t: Template): { client: ClientId; name: string; prompt: string }[] {
  return CLIENTS.map((c) => ({ client: c.id, name: c.name, prompt: `${createStep(t)}\n\nThen: ${t.prompt[c.key] ?? t.prompt.default}\n\n${fencedNote(t)}` }));
}

/// The markdown inside a prompt's fence, as create_note would get it.
export function markdownIn(prompt: string): string | null {
  const m = prompt.match(/```markdown\n([\s\S]*?)\n```\s*$/);
  return m ? m[1] + "\n" : null;
}

/// The public, read-only data the app fetches from /templates/<slug>.json.
export function publicTemplate(t: Template) {
  return {
    version: 1,
    slug: t.slug,
    title: t.title,
    category: t.category,
    audience: t.audience,
    description: t.description,
    folder: t.folder,
    note: t.note,
    instructions: instructions(t),
    example: t.example,
    url: `${SITE_URL}${templatePath(t.slug)}`,
  };
}

/// The note as the app shows it, title left out (the page shows it on its own).
export function renderTemplate(markdown: string, changedFrom?: string): string {
  const body = withoutTitle(markdown);
  return renderNote(body, {
    files: {},
    subNoteHref: () => null,
    typedTables: true,
    changedLines: changedFrom === undefined ? undefined : changedLines(withoutTitle(changedFrom), body),
  });
}

/// The 1-based lines of `after` that weren't in `before`: what the AI added or changed.
export function changedLines(before: string, after: string): Set<number> {
  const left = new Map<string, number>();
  for (const l of before.split("\n")) left.set(l, (left.get(l) ?? 0) + 1);
  const out = new Set<number>();
  after.split("\n").forEach((l, i) => {
    const n = left.get(l) ?? 0;
    if (n > 0) left.set(l, n - 1);
    else if (l.trim()) out.add(i + 1);
  });
  return out;
}

/// How many lines the example adds or changes, for the "changed N lines" bar.
export const changedCount = (t: Template) => changedLines(t.note, t.example).size;

/// A plain-text line from a note's body, for previews.
export const preview = (t: Template) => summary(withoutTitle(t.note), 120);

/// One row of a card's slice of the note, drawn the way Amber Notes draws it. `fresh` marks the line
/// the app would tint as just added by an AI (for a table, the index of that row).
export type SliceRow =
  | { kind: "heading"; text: string }
  | { kind: "label"; text: string }
  | { kind: "check"; text: string; done: boolean; fresh?: boolean }
  | { kind: "item"; text: string; label?: string; fresh?: boolean }
  | { kind: "text"; text: string; label?: string; fresh?: boolean }
  | { kind: "quote"; text: string; fresh?: boolean }
  | { kind: "subnote"; text: string; fresh?: boolean }
  | { kind: "table"; columns: string[]; rows: string[][]; fresh?: number };

/// Where each card's slice starts, chosen per template so the first lines show what makes it
/// useful: a filled table, ticked items, the newest day or decision. The slice runs on from there
/// across sections, so the card's panel is always full.
const SLICE_FROM: Record<string, string> = {
  "habit-tracker": "|", "meeting-notes": "Open action items", "daily-standup": "30 September", "meal-plan": "|",
  "reading-list": "|", "mood-energy-log": "|", "job-hunt": "|", "trip-plan": "|", "study-flashcards": "Cell respiration",
  "decision-log": "Stay on Postgres, 29 September", "workout-log": "|", "budget-log": "|", "one-on-one-notes": "Follow-ups",
  "book-notes": "Four Thousand Weeks by Oliver Burkeman", "bug-triage": "|", "weekly-review": "Week of 28 September",
  "recipe-box": "Weeknight", "content-calendar": "|", "home-maintenance": "|", "gift-ideas": "|",
  "cornell-notes": "Supply and demand, 1 October", "daily-journal": "Friday 2 October", "grocery-list": "Fruit and veg",
};

/// The card's slice of the filled-in example, about `lines` lines long: from the template's chosen
/// start, its heading, then tables (their filled-in rows) and list items, across sections. The
/// first table's newest row, or else the first item, is tinted.
export function slice(t: Template, lines = 8): SliceRow[] {
  const md = withoutTitle(t.example).split("\n");
  const plain = (s: string) => s.replace(/\*\*|__|`/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim();
  const heading = (l: string) => l.match(/^(#{1,6})\s+(.*)$/);
  const from = SLICE_FROM[t.slug] ?? "|";
  const at = from === "|" ? md.findIndex((l) => l.trim().startsWith("|")) : md.findIndex((l) => heading(l)?.[2].trim() === from);
  if (at < 0) return [];
  const out: SliceRow[] = [];
  let used = 0, tinted = false;
  const labelled = (rest: string) => { const m = rest.match(/^\*\*(.+?)\*\*\s*(.*)$/); return m ? { label: m[1], text: plain(m[2]) } : { text: plain(rest) }; };
  for (let i = at; i < md.length && used < lines; i++) {
    const l = md[i];
    if (!l.trim() || l.trim().startsWith("<!--")) continue;
    const h = heading(l);
    // Past the first block, headings and labels would land alone at the panel's faded foot, so the
    // slice runs on with the lines themselves.
    const started = out.some((r) => r.kind !== "heading" && r.kind !== "label");
    if ((h || /^\*\*[^*]+\*\*$/.test(l.trim())) && started) continue;
    if (h) {
      // A heading with nothing under it (an empty section) adds nothing to a card.
      const next = md.slice(i + 1).find((x) => x.trim() && !x.trim().startsWith("<!--"));
      if (!next || heading(next)) continue;
      out.push({ kind: "heading", text: plain(h[2]) }); used++; continue;
    }
    if (l.trim().startsWith("|")) {
      const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map(plain);
      const rows: string[][] = [];
      let j = i + 2;
      for (; j < md.length && md[j].trim().startsWith("|"); j++) rows.push(cells(md[j]));
      const filled = rows.filter((r) => r.filter(Boolean).length * 2 >= r.length).slice(0, 3);
      out.push({ kind: "table", columns: cells(l), rows: filled, fresh: tinted ? undefined : filled.length - 1 });
      tinted = true; used += 1 + filled.length; i = j - 1; continue;
    }
    const fresh = !tinted || undefined;
    const c = l.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
    const b = l.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (c) out.push({ kind: "check", text: plain(c[2]), done: c[1] !== " ", fresh });
    else if (/^\s*\[[^\]]+\]\(pane-note:/.test(l)) out.push({ kind: "subnote", text: plain(l), fresh });
    else if (b) out.push({ kind: "item", ...labelled(b[1]), fresh });
    else if (l.startsWith(">")) out.push({ kind: "quote", text: plain(l.replace(/^>\s*/, "")), fresh });
    else if (/^\*\*[^*]+\*\*$/.test(l.trim())) {
      // A label right under the opening heading joins it ("30 September · Yesterday"), so the lines
      // under it get the room.
      const prev = out[out.length - 1];
      if (out.length === 1 && prev.kind === "heading") prev.text += ` · ${plain(l)}`;
      else { out.push({ kind: "label", text: plain(l) }); used++; }
      continue;
    }
    else out.push({ kind: "text", ...labelled(l.trim()), fresh });
    tinted = true; used++;
  }
  return out;
}

/// Templates in a category or for an audience, for the filters' counts.
export const inCategory = (c: Category) => templates().filter((t) => t.category === c);
export const forAudience = (a: Audience) => templates().filter((t) => t.audiences.includes(a));
