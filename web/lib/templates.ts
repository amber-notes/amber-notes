import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { renderNote, summary, withoutTitle } from "./render";
import { SITE_URL } from "./site";

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
  /// The meta description and the card text: one or two sentences, 70 to 160 characters.
  description: string;
  /// The search title, when "<title> template for ChatGPT and Claude" isn't the best one.
  seoTitle?: string;
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
};

export const ORDER = [
  "habit-tracker", "meeting-notes", "daily-standup", "meal-plan", "reading-list",
  "mood-energy-log", "job-hunt", "trip-plan", "study-flashcards", "decision-log",
  "workout-log", "budget-log", "one-on-one-notes", "book-notes", "bug-triage",
  "weekly-review", "recipe-box", "content-calendar", "home-maintenance", "gift-ideas",
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
export const validTemplateSlug = (s: string) => s.length <= 64 && SLUG.test(s);

export const anchor = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const searchTitle = (t: Template) => t.seoTitle ?? `${t.title} template for ChatGPT and Claude`;
export const templatePath = (slug: string) => `/templates/${slug}`;
/// The universal link the app opens (https://ambernotes.app/open/template/<slug>).
export const useLink = (slug: string) => `${SITE_URL}/open/template/${slug}`;
export const appLink = (slug: string) => `ambernotes://template/${slug}`;

/// What to tell each AI, resolved: every client gets its own text or the shared one.
export function instructions(t: Template): { client: ClientId; name: string; prompt: string }[] {
  return CLIENTS.map((c) => ({ client: c.id, name: c.name, prompt: t.prompt[c.key] ?? t.prompt.default }));
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

/// The note's shape for a card: headings, checklist items, list items and table columns, in order.
export type Shape =
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string }
  | { kind: "check"; text: string; done: boolean }
  | { kind: "item"; text: string }
  | { kind: "table"; columns: string[]; rows: string[][] };

/// The template's real structure, read from its markdown (the example's, so the card shows a
/// filled-in note), for the miniature on each card.
export function shape(markdown: string, max = 9): Shape[] {
  const lines = withoutTitle(markdown).split("\n");
  const out: Shape[] = [];
  const plain = (s: string) => s.replace(/\*\*|__|`/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim();
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const l = lines[i];
    if (!l.trim() || l.trim().startsWith("<!--")) continue;
    const h = l.match(/^#{1,6}\s+(.*)$/);
    if (h) { out.push({ kind: "heading", text: plain(h[1]) }); continue; }
    if (l.trim().startsWith("|")) {
      const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => plain(c));
      const columns = cells(l);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith("|")) { rows.push(cells(lines[j])); j++; }
      out.push({ kind: "table", columns, rows: rows.slice(-3) });
      i = j - 1;
      continue;
    }
    const c = l.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (c) { out.push({ kind: "check", text: plain(c[2]), done: c[1] !== " " }); continue; }
    const b = l.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (b) { out.push({ kind: "item", text: plain(b[1]) }); continue; }
    if (out.length === 0 || out[out.length - 1].kind === "heading") out.push({ kind: "text", text: plain(l.replace(/^>\s*/, "")) });
  }
  return out;
}

/// Templates in a category or for an audience, for the filters' counts.
export const inCategory = (c: Category) => templates().filter((t) => t.category === c);
export const forAudience = (a: Audience) => templates().filter((t) => t.audiences.includes(a));
