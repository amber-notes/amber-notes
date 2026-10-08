import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import { MCP_TOOLS } from "./mcp-tools";
import { AUDIENCES, CATEGORIES, GITHUB_HANDLE, ORDER, SLUG, changedLines, createStep, instructions, markdownIn, publicTemplate, renderTemplate, searchTitle, slice, templateFiles, templates, validTemplateSlug, type DemoCall, type Template } from "./templates";

// The server's own note functions (supabase/functions/mcp/notes.ts, plain TypeScript with no
// imports), loaded by path so the site's build never depends on the server folder.
type Col = { name: string; type: { kind: string } };
type Table = { columns: Col[]; rows: string[][]; start: number; end: number; typed: boolean };
type Notes = {
  titleOf(body: string): string;
  appendText(body: string, text: string, underHeading?: string, atStart?: boolean): string;
  applyEdits(body: string, edits: { old_text: string; new_text: string }[]): string;
  setChecklistItem(body: string, item: string, checked: boolean): { body: string };
  findTables(body: string): Table[];
  replaceTable(body: string, t: Table): string;
  coerce(value: unknown, col: Col, today: string): string;
};
const SERVER = path.resolve(__dirname, "../../supabase/functions/mcp/notes.ts");
const notes = (await import(/* @vite-ignore */ SERVER)) as Notes;

/// One tool call, the way supabase/functions/mcp/tools.ts runs it on the note's body.
function run(body: string, { tool, args }: DemoCall): string {
  const a = args as Record<string, any>;
  switch (tool) {
    case "append_to_note":
      return notes.appendText(body, a.text, a.under_heading, a.at_start === true);
    case "edit_note":
      return notes.applyEdits(body, a.edits);
    case "set_checklist_item":
      return notes.setChecklistItem(body, a.item, a.checked === true).body;
    case "create_sub_note": {
      // The sub-note itself is a note of its own; the parent gets the link (the id is fixed here).
      const link = `[${notes.titleOf(a.body).replace(/[[\]]/g, "")}](pane-note:${a.id})`;
      return notes.appendText(body, link, a.under_heading);
    }
    case "log_table_row": {
      const all = notes.findTables(body);
      const t = a.table === undefined ? all.find((x) => x.typed) ?? all[0] : all[a.table];
      if (!t) throw new Error("This note has no table.");
      const byName = new Map(t.columns.map((c, i) => [c.name.toLowerCase(), i]));
      const unknown = Object.keys(a.values).filter((k) => !byName.has(k.toLowerCase()));
      if (unknown.length) throw new Error(`Unknown column(s): ${unknown.join(", ")}`);
      const dateCol = t.columns.findIndex((c) => c.type.kind === "date");
      const incoming = new Map<number, string>();
      for (const [k, v] of Object.entries(a.values)) {
        const i = byName.get(k.toLowerCase())!;
        incoming.set(i, notes.coerce(v, t.columns[i], "2026-09-30"));
      }
      if (dateCol >= 0 && !incoming.get(dateCol)) throw new Error("demo rows give their date");
      const existing = dateCol >= 0 ? t.rows.findIndex((r) => r[dateCol] === incoming.get(dateCol)) : -1;
      const row = existing >= 0 ? [...t.rows[existing]] : t.columns.map(() => "");
      for (const [i, v] of incoming) row[i] = v;
      if (existing >= 0) t.rows[existing] = row; else t.rows.push(row);
      if (dateCol >= 0) t.rows.sort((x, y) => x[dateCol].localeCompare(y[dateCol]));
      return notes.replaceTable(body, t);
    }
    default:
      throw new Error(`The demo can't replay ${tool}`);
  }
}

const replay = (t: Template) => t.demo.reduce(run, t.note);

// FILL_EXAMPLES=1 pnpm vitest run lib/templates.test.ts writes each example from its demo calls.
if (process.env.FILL_EXAMPLES) {
  for (const t of templates()) {
    const file = path.resolve(__dirname, `../content/templates/${t.slug}.json`);
    const json = JSON.parse(readFileSync(file, "utf8"));
    json.example = replay(t);
    writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  }
}

const all = templates();
const toolNames = new Set(MCP_TOOLS.map((t) => t.name));
const texts = (t: Template) => [t.title, t.audience, t.description, t.seoTitle ?? "", t.folder, t.note, t.example, ...Object.values(t.prompt), ...t.asks];

describe("the template library", () => {
  it("has at least 15 templates, every file listed once in ORDER", () => {
    expect(all.length).toBeGreaterThanOrEqual(15);
    expect([...templateFiles()].sort()).toEqual([...ORDER].sort());
    expect(new Set(ORDER).size).toBe(ORDER.length);
  });

  it("gives every template a unique, valid slug that matches its file", () => {
    for (const t of all) {
      expect(validTemplateSlug(t.slug), t.slug).toBe(true);
      expect(SLUG.test(t.slug)).toBe(true);
    }
    expect(new Set(all.map((t) => t.slug)).size).toBe(all.length);
  });

  it("follows the schema", () => {
    const keys = ["slug", "title", "category", "audiences", "audience", "description", "tagline", "seoTitle", "folder", "note", "prompt", "asks", "demo", "example", "related", "updated", "author"];
    for (const t of all) {
      for (const k of Object.keys(t)) expect(keys, `${t.slug}: ${k}`).toContain(k);
      expect(CATEGORIES).toContain(t.category);
      expect(t.audiences.length).toBeGreaterThan(0);
      for (const a of t.audiences) expect(AUDIENCES).toContain(a);
      expect(t.audience.length, t.slug).toBeLessThanOrEqual(110);
      expect(t.description.length, t.slug).toBeGreaterThanOrEqual(70);
      expect(t.description.length, t.slug).toBeLessThanOrEqual(160);
      expect(t.tagline.length, t.slug).toBeGreaterThan(0);
      expect(t.tagline.length, t.slug).toBeLessThanOrEqual(50);
      expect(t.folder.trim().length).toBeGreaterThan(0);
      expect(typeof t.prompt.default).toBe("string");
      for (const k of Object.keys(t.prompt)) expect(["default", "chatgpt", "claude", "claudeCode"]).toContain(k);
      expect(t.asks.length, t.slug).toBeGreaterThanOrEqual(2);
      expect(t.demo.length, t.slug).toBeGreaterThan(0);
      expect(t.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (t.author !== undefined) expect(GITHUB_HANDLE.test(t.author), `${t.slug}: author is a GitHub handle without the @`).toBe(true);
    }
  });

  it("takes a GitHub handle as the author, and nothing else", () => {
    for (const ok of ["arnavtambe", "a", "wufangyong973", "Some-Body", "x".repeat(39)]) expect(GITHUB_HANDLE.test(ok), ok).toBe(true);
    for (const bad of ["@arnav", "-lead", "trail-", "dou--ble", "has space", "x".repeat(40), "https://github.com/a", ""]) expect(GITHUB_HANDLE.test(bad), bad).toBe(false);
  });

  it("gives every template a unique search title of at most 60 characters", () => {
    const titles = all.map(searchTitle);
    for (const [i, s] of titles.entries()) expect(s.length, all[i].slug).toBeLessThanOrEqual(60);
    expect(new Set(titles).size).toBe(all.length);
    expect(new Set(all.map((t) => t.description)).size).toBe(all.length);
  });

  it("relates each template to three others that exist", () => {
    for (const t of all) {
      expect(t.related).toHaveLength(3);
      for (const r of t.related) {
        expect(r).not.toBe(t.slug);
        expect(ORDER, `${t.slug} → ${r}`).toContain(r);
      }
    }
  });

  it("has templates in every category and for every audience", () => {
    for (const c of CATEGORIES) expect(all.some((t) => t.category === c), c).toBe(true);
    for (const a of AUDIENCES) expect(all.some((t) => t.audiences.includes(a)), a).toBe(true);
  });
});

describe("each note", () => {
  it("starts with its title as a plain first line, then a blank line", () => {
    for (const t of all) {
      const [first, second] = t.note.split("\n");
      expect(first, t.slug).toBe(t.title);
      expect(notes.titleOf(t.note)).toBe(first);
      expect(second).toBe("");
    }
  });

  it("parses as markdown with the structure the app shows", () => {
    const parse = (s: string) => unified().use(remarkParse).use(remarkGfm).parse(s);
    for (const t of all) {
      for (const md of [t.note, t.example]) {
        const tree = parse(md) as { children: { type: string }[] };
        expect(tree.children.length, t.slug).toBeGreaterThan(1);
        expect(tree.children.some((c) => c.type === "heading" || c.type === "table"), t.slug).toBe(true);
      }
    }
  });

  it("declares its typed tables the way the server reads them, with the type line on every typed one", () => {
    for (const t of all) {
      const tables = notes.findTables(t.note);
      const typeLines = t.note.split("\n").filter((l) => l.includes("pane-table:")).length;
      expect(tables.filter((x) => x.typed).length, t.slug).toBe(typeLines);
      for (const x of tables) {
        expect(x.columns.length, t.slug).toBeGreaterThan(1);
        expect(new Set(x.columns.map((c) => c.name.toLowerCase())).size, t.slug).toBe(x.columns.length);
        // A table the server rewrites keeps its own header exactly.
        if (x.typed) expect(notes.replaceTable(t.note, x), t.slug).toBe(t.note);
      }
    }
  });

  it("renders without anything the app wouldn't show", () => {
    for (const t of all) {
      const html = renderTemplate(t.note) + renderTemplate(t.example, t.note);
      expect(html).not.toContain("pane-table");
      expect(html).not.toContain("<script");
    }
  });
});

describe("the instructions", () => {
  it("name the note by its title", () => {
    for (const t of all) {
      const title = t.note.split("\n")[0];
      for (const i of instructions(t)) expect(i.prompt, `${t.slug} (${i.name})`).toContain(`"${title}"`);
    }
  });

  it("start by creating the note, and the create step produces exactly the template's markdown", () => {
    for (const t of all) {
      for (const i of instructions(t)) {
        expect(i.prompt.startsWith(createStep(t)), `${t.slug} (${i.name})`).toBe(true);
        expect(i.prompt).toContain(`create_note in the folder "${t.folder}"`);
        // create_note stores the body as it's given; the title is its first line.
        const body = markdownIn(i.prompt);
        expect(body, `${t.slug} (${i.name})`).toBe(t.note);
        expect(notes.titleOf(body!)).toBe(t.title);
        expect(notes.findTables(body!).map((x) => x.columns), t.slug).toEqual(notes.findTables(t.note).map((x) => x.columns));
      }
    }
  });

  it("only use tools the Pinto Notes MCP server has, and use at least one that writes", () => {
    const writes = new Set(MCP_TOOLS.filter((x) => x.kind !== "read").map((x) => x.name));
    for (const t of all) {
      for (const i of instructions(t)) {
        // Snake case names a tool, or one of the tools' own options.
        const used = [...i.prompt.matchAll(/\b([a-z]+(?:_[a-z]+)+)\b/g)].map((m) => m[1]).filter((w) => !["at_start", "under_heading"].includes(w));
        expect(used.length, t.slug).toBeGreaterThan(0);
        for (const u of used) expect(toolNames.has(u), `${t.slug} (${i.name}) uses ${u}`).toBe(true);
        expect(used.some((u) => writes.has(u)), t.slug).toBe(true);
      }
      for (const d of t.demo) expect(toolNames.has(d.tool), `${t.slug} demo uses ${d.tool}`).toBe(true);
    }
  });

  it("only name headings the note has", () => {
    for (const t of all) {
      const headings = new Set([...t.note.matchAll(/^#{1,6}\s+(.*)$/gm)].map((m) => m[1].trim()));
      for (const prompt of Object.values(t.prompt)) {
        for (const m of prompt.matchAll(/under "([^"]+)"|of "([^"]+)"|start of "([^"]+)"|from "([^"]+)"|to the "([^"]+)"/g)) {
          const name = m.slice(1).find(Boolean)!;
          expect(headings.has(name), `${t.slug} names "${name}"`).toBe(true);
        }
      }
    }
  });

  it("stay short enough to copy and paste", () => {
    // The instruction itself; the create step and the note's markdown come with it.
    for (const t of all) for (const p of Object.values(t.prompt)) expect(p.length, t.slug).toBeLessThanOrEqual(720);
  });

  it("never promise the AI acts on its own on a schedule", () => {
    for (const t of all) {
      const s = [...Object.values(t.prompt), t.description, t.audience, t.note].join(" ");
      expect(s, t.slug).not.toMatch(/\b(will remind|reminds you|automatically|every day at|on its own)\b/i);
    }
  });
});

describe("the example", () => {
  it("is exactly what the demo calls produce with the server's own note functions", () => {
    for (const t of all) expect(t.example, t.slug).toBe(replay(t));
  });

  it("adds something to the note, and keeps the title", () => {
    for (const t of all) {
      expect(changedLines(t.note, t.example).size, t.slug).toBeGreaterThan(0);
      expect(t.example.split("\n")[0]).toBe(t.note.split("\n")[0]);
    }
  });

  it("shows a full slice of the real note on the card, with one tinted line", () => {
    for (const t of all) {
      const rows = slice(t);
      const lines = rows.reduce((n, r) => n + (r.kind === "table" ? 1 + r.rows.length : 1), 0);
      expect(lines, t.slug).toBeGreaterThanOrEqual(5);
      const tinted = rows.filter((r) => (r.kind === "table" ? r.fresh !== undefined : "fresh" in r && r.fresh));
      expect(tinted.length, t.slug).toBe(1);
      for (const r of rows) if (r.kind === "table") expect(r.rows.length, t.slug).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("the public data the app reads", () => {
  it("has the fields the app decodes, with an instruction for each client", () => {
    for (const t of all) {
      const p = publicTemplate(t);
      expect(p.version).toBe(1);
      expect(p.url).toBe(`https://ambernotes.app/templates/${t.slug}`);
      expect(p.instructions.map((i) => i.client)).toEqual(["chatgpt", "claude", "claude-code"]);
      expect(p.instructions.map((i) => i.name)).toEqual(["ChatGPT", "Claude", "Claude Code"]);
      expect(Object.keys(p)).not.toContain("demo");
    }
  });

  it("rejects slugs that aren't a template's shape", () => {
    for (const bad of ["", "Habit", "habit_tracker", "../etc", "a--b", "-a", "a".repeat(65), "habit tracker"]) expect(validTemplateSlug(bad), bad).toBe(false);
  });
});

describe("template copy", () => {
  it("uses no em dashes", () => { for (const t of all) for (const s of texts(t)) expect(s, t.slug).not.toContain("—"); });
  it("names only the devices the app runs on", () => { for (const t of all) for (const s of texts(t)) expect(s, t.slug).not.toMatch(/ipad/i); });
  it("writes titles in sentence case", () => {
    for (const t of all) {
      const words = t.title.split(" ").slice(1);
      for (const w of words) expect(/^[a-z0-9:]/.test(w) || ["ChatGPT", "Claude", "AI"].includes(w), `${t.slug}: ${w}`).toBe(true);
    }
  });
});
