// check_app and preview_app: let an AI see what it built. See app_check.ts for the findings and
// app_sample.ts for the sample a note's app is rendered over.

import { type KeyInfo, render, renderedReport, staticReport, titleReport } from "./app_check.ts";
import { noteForPage } from "./page_input.ts";
import { sampleData, sampleNote } from "./app_sample.ts";
import { bodyOf, Content, findNote, ToolError, type Call, type Tx } from "./tools.ts";

type Args = Record<string, unknown>;
const str = (d: string) => ({ type: "string", description: d });
const noteRef = { id: str("Note id (preferred)."), title: str("Note title, if you don't have the id. Must match one note.") };
const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export const appTools = [
  {
    name: "check_app", title: "Check a note's app",
    description: "Checks a note's app and reports what to fix, as text: the note's title as the app's first heading (and only once), script errors, at 375, 768 and 1280 px: sideways scrolling, clipped text, a layout that leaves most of a wide window empty, text that is too small or low in contrast (light and dark), controls without labels or under 44 px on the phone, not using the --amber-* theme, an edit from the app that fails, breakage with an empty or 400-row note, unescaped note text, and network hosts or API keys declared vs used vs set up. " +
      "Run it after every set_note_page or edit_note_page and fix what it finds before telling the person the app is done. It renders a sample with the note's shape, not the person's data.",
    inputSchema: { type: "object", properties: { ...noteRef } },
    annotations: read,
  },
  {
    name: "preview_app", title: "See a note's app",
    description: "Screenshots of a note's app as images, at the widths and in the color schemes asked for (default a 375 px phone and a 1280 px window, light and dark), with a text description of each for clients that can't show images. " +
      "Use it after building or changing an app, when you can see images, to judge layout and design; fix what looks wrong. By default the app shows a sample with the note's shape and none of its content; data: \"real\" works only if the person turned on previews with real data in Amber Notes.",
    inputSchema: {
      type: "object",
      properties: {
        ...noteRef,
        widths: { type: "array", items: { type: "integer" }, description: "Widths in px, 320-1800. Default [375, 1280]." },
        themes: { type: "array", items: { type: "string", enum: ["light", "dark"] }, description: "Default [\"light\", \"dark\"]." },
        data: { type: "string", enum: ["sample", "real"], description: "Default sample." },
      },
    },
    annotations: read,
  },
];

const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: Deno.env.get("PANE_TIMEZONE") ?? "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function appOf(tx: Tx, c: Call, a: Args) {
  const n = await findNote(tx, c, a, true);
  const [row] = await tx<{ page_ct: string | null; data_ct: string | null }[]>`select page_ct, data_ct from public.note_pages where note_id = ${n.id}`;
  if (!row?.page_ct) throw new ToolError(`"${n.title}" has no app yet. Make one with set_note_page.`);
  let html: string, data: unknown = { values: {}, collections: {} };
  try { html = await c.v.openPage(n.id, row.page_ct); } catch { throw new ToolError("This note's app can't be opened with this connection's key."); }
  if (row.data_ct) { try { data = JSON.parse(await c.v.openPageData(n.id, row.data_ct)); } catch { /* checked without its data */ } }
  return { n, html, data, body: await bodyOf(c.v, n) };
}

async function keysOf(tx: Tx, c: Call): Promise<KeyInfo[]> {
  const rows = await tx<{ id: string; meta_ct: string }[]>`select id, meta_ct from public.api_key_names`;
  const out: KeyInfo[] = [];
  for (const r of rows) {
    try {
      const m = JSON.parse(await c.v.openAPIKeyMeta(r.id, r.meta_ct));
      out.push({ name: String(m.name ?? ""), hosts: Array.isArray(m.hosts) ? m.hosts.map(String) : [], set: m.set === true });
    } catch { /* sealed with another key */ }
  }
  return out;
}

export const appHandlers: Record<string, (tx: Tx, a: Args, c: Call) => Promise<unknown>> = {
  async check_app(tx, a, c) {
    const { n, html, data, body } = await appOf(tx, c, a);
    const t = today();
    const found = staticReport(html, body, await keysOf(tx, c));
    const r = await render({
      html, markdown: sampleNote(body, t), data: sampleData(data, t), today: t,
      views: [{ width: 375, scheme: "light" }, { width: 375, scheme: "dark" }, { width: 768, scheme: "light" }, { width: 1280, scheme: "light" }], interact: true, probes: true,
    });
    const browser = typeof r === "string" ? null : [...titleReport(r, noteForPage(sampleNote(body, t), t).title), ...renderedReport(r)];
    const issues = [...found.errors, ...found.warnings, ...(browser ?? [])];
    return {
      app: { id: n.id, title: n.title },
      ok: issues.length === 0 && browser !== null,
      ...(found.errors.length ? { refused_by_server: found.errors } : {}),
      issues,
      ...(browser === null ? { browser: r } : { browser_checked: "375 px light and dark, 768 and 1280 px light, over a sample note" }),
      next: issues.length ? "Fix these with edit_note_page (or set_note_page), then run check_app again." : "Nothing to fix.",
    };
  },

  async preview_app(tx, a, c) {
    const { n, html, data, body } = await appOf(tx, c, a);
    const widths = (Array.isArray(a.widths) && a.widths.length ? a.widths : [375, 1280]).map(Number).filter((w) => Number.isInteger(w) && w >= 320 && w <= 1800).slice(0, 3);
    const themes = (Array.isArray(a.themes) && a.themes.length ? a.themes : ["light", "dark"]).filter((x) => x === "light" || x === "dark") as ("light" | "dark")[];
    const views = widths.flatMap((width) => themes.map((scheme) => ({ width, scheme }))).slice(0, 4);
    if (!views.length) throw new ToolError("Give widths between 320 and 1800 and themes light or dark.");
    const real = a.data === "real";
    if (real) {
      const [p] = await tx<{ app_previews_real: boolean }[]>`select app_previews_real from public.profiles where user_id = ${c.ctx.userId}`;
      if (!p?.app_previews_real) throw new ToolError("Previews with real data are off. They show a sample with the same shape by default (data: \"sample\"). The person can allow real data in Amber Notes › Settings › Apps in Notes, \"Let AIs preview apps with my notes\".");
    }
    const t = today();
    const r = await render({ html, markdown: real ? body : sampleNote(body, t), data: real ? data : sampleData(data, t), today: t, views, capture: true, interact: false, probes: false });
    if (typeof r === "string") return { app: { id: n.id, title: n.title }, previews: "unavailable", reason: r, instead: "Run check_app for the checks that need no browser." };
    const issues = [...titleReport(r, noteForPage(real ? body : sampleNote(body, t), t).title), ...renderedReport(r)];
    const blocks: Record<string, unknown>[] = [{
      type: "text",
      text: JSON.stringify({
        app: n.title, data: real ? "the person's real data" : "a sample with the note's shape (not the person's data)",
        views: r.views.map((v) => ({ view: v.name, headings: v.headings, text: v.excerpt })), issues,
      }, null, 2),
    }];
    for (const v of r.views) {
      if (!v.png) continue;
      blocks.push({ type: "text", text: `${v.name}:` });
      blocks.push({ type: "image", data: v.png, mimeType: "image/png" });
    }
    return new Content(blocks, { app: { id: n.id, title: n.title }, views: r.views.map((v) => v.name), issues });
  },
};
