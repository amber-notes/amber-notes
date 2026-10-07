// check_app and preview_app: let an AI see what it built. See app_check.ts for the findings and
// app_sample.ts for the sample a note's app is rendered over.

import { type KeyInfo, render, renderedFindings, staticReport, testSummary, titleReport } from "./app_check.ts";
import { noteForPage } from "./page_input.ts";
import { resolvePackage } from "./libraries.ts";
import { sampleData, sampleNote } from "./app_sample.ts";
import { bodyOf, Content, findNote, ToolError, type Call, type Tx } from "./tools.ts";

type Args = Record<string, unknown>;
const str = (d: string) => ({ type: "string", description: d });
const noteRef = { id: str("Note id (preferred)."), title: str("Note title, if you don't have the id. Must match one note.") };
const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export const appTools = [
  {
    name: "check_app", title: "Check a note's app",
    description: "Checks a note's app and reports what to fix, as text: the note's title as the app's first heading (and only once), script errors, at 390 and 320 px (iPhone) and 1280 px (Mac): sideways scrolling, clipped text, a layout that leaves most of a wide window empty, text that is too small or low in contrast (light and dark), controls without labels or under 44 px on the phone, not using the --amber-* theme, an edit from the app that fails, breakage with an empty or 400-row note, unescaped note text, and network hosts or API keys declared vs used vs set up. " +
      "Run it after every set_note_page or edit_note_page and fix what it finds before telling the person the app is done. It renders a sample with the note's shape, not the person's data.",
    inputSchema: { type: "object", properties: { ...noteRef } },
    annotations: read,
  },
  {
    name: "preview_app", title: "See a note's app",
    description: "Screenshots of a note's app as images, at the widths and in the color schemes asked for (default a 390 px iPhone and a 1280 px Mac window, light and dark), with a text description of each for clients that can't show images. " +
      "Use it after building or changing an app, when you can see images, to judge layout and design; fix what looks wrong. By default the app shows a sample with the note's shape and none of its content; data: \"real\" works only if the person turned on previews with real data in Amber Notes.",
    inputSchema: {
      type: "object",
      properties: {
        ...noteRef,
        widths: { type: "array", items: { type: "integer" }, description: "Widths in px, 320-1800. Default [390, 1280] (iPhone and Mac)." },
        themes: { type: "array", items: { type: "string", enum: ["light", "dark"] }, description: "Default [\"light\", \"dark\"]." },
        data: { type: "string", enum: ["sample", "real"], description: "Default sample." },
      },
    },
    annotations: read,
  },
  {
    name: "try_app", title: "Use a note's app",
    description: "Uses the app like a person would, in a browser, and shows you what happened after each step: what's on screen (headings, buttons, fields and their values, text), console errors, what changed in the app's data, and screenshots. " +
      "Steps: { tap: \"Add\" } (a button, link or tab by its text or label, or a CSS selector), { type: \"85\", into: \"Weight\" } (a field by its label or placeholder), { scroll: \"down\" | \"up\" }, { wait: 500 | \"Saved\" }, { press: \"Enter\" }, { resize: \"phone\" | \"desktop\" }, { dark: true | false }. " +
      "It runs on a throwaway copy: a sample with the shape of the app's data by default (data: \"real\" only if the person allowed it), and nothing is ever written back.",
    inputSchema: {
      type: "object",
      properties: {
        ...noteRef,
        steps: { type: "array", items: { type: "object" }, description: "Up to 30 steps, done in order." },
        start: { type: "string", enum: ["phone", "desktop"], description: "Window to start in (default phone, 390 px)." },
        screenshots: { type: "string", enum: ["last", "each", "none"], description: "Default last (and any step that failed)." },
        data: { type: "string", enum: ["sample", "real"], description: "Default sample." },
      },
      required: ["steps"],
    },
    annotations: read,
  },
  {
    name: "run_app_tests", title: "Run a note's app tests",
    description: "Runs the app's tests: files under tests/ named *.test.tsx (or .ts, .jsx, .js), written like Vitest with Testing Library: import { describe, it, expect, vi } from \"vitest\"; import { render, screen, within, waitFor } from \"@testing-library/react\"; import userEvent from \"@testing-library/user-event\"; expect has the usual and jest-dom matchers (toBeInTheDocument, toHaveTextContent, toHaveValue…). " +
      "They run in a browser against a throwaway copy of the app's data, which starts over for each test, and every save runs them too. Returns passed, failed and each failure's message.",
    inputSchema: { type: "object", properties: { ...noteRef } },
    annotations: read,
  },
  {
    name: "resolve_package", title: "Pin an npm package for an app",
    description: "For a library Amber Notes doesn't bundle: looks up an npm package's file at an exact version and returns the entry to add to the note's app, with its hash, e.g. <meta name=\"amber-libs\" content=\"npm:qrcode-generator@1.4.4/qrcode.js#sha256-…\">. Amber Notes downloads that exact file once, checks the hash and keeps it on the device. Pick a UMD or global build. Never paste a library's code into an app, and prefer the bundled ones (chart, d3, three, tone, dayjs, marked, purify, anime, confetti, topojson, world).",
    inputSchema: { type: "object", properties: { name: str("npm package name, e.g. \"qrcode\" or \"@scope/pkg\"."), version: str("Exact version or range; default latest."), file: str("A file in the package, e.g. \"build/qrcode.js\"; default the package's browser build.") }, required: ["name"] },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
];

const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: Deno.env.get("PANE_TIMEZONE") ?? "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function appOf(tx: Tx, c: Call, a: Args) {
  const n = await findNote(tx, c, a, true);
  // The AI's draft when its last save was held back (what it's working on), else the live app.
  const [row] = await tx<{ page_ct: string | null; draft_ct: string | null; data_ct: string | null }[]>`select page_ct, draft_ct, data_ct from public.note_pages where note_id = ${n.id}`;
  const box = row?.draft_ct ?? row?.page_ct;
  if (!box) throw new ToolError(`"${n.title}" has no app yet. Make one with create.`);
  let html: string, data: unknown = { values: {}, collections: {} };
  try { html = await c.v.openPage(n.id, box); } catch { throw new ToolError("This note's app can't be opened with this connection's key."); }
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
      views: [{ width: 390, scheme: "light" }, { width: 390, scheme: "dark" }, { width: 320, scheme: "light" }, { width: 1280, scheme: "light" }, { width: 1280, scheme: "dark" }], interact: true, probes: true,
      // Shown inside a parent note too: also as the widget strip.
      widget: n.parent_id !== null || /amber-widget/.test(html),
    });
    const browser = typeof r === "string" ? null : renderedFindings(r);
    const errors = [...found.errors, ...(browser?.errors ?? [])];
    const notes = [...found.warnings, ...(typeof r === "string" ? [] : titleReport(r, noteForPage(sampleNote(body, t), t).title)), ...(browser?.notes ?? [])];
    return {
      app: { id: n.id, title: n.title },
      ok: errors.length === 0 && browser !== null,
      errors,
      notes,
      ...(browser === null ? { browser: r } : { browser_checked: `390 px and 1280 px in light and dark, and 320 px${n.parent_id !== null || /amber-widget/.test(html) ? ", and the 340 px widget strip" : ""}, over a sample of its data` }),
      next: errors.length ? "Fix the errors: the app is broken for the person until they're gone. The notes are information; act on the ones you agree with." : notes.length ? "Nothing is broken. The notes are information; act on the ones you agree with." : "Nothing to fix.",
    };
  },

  async try_app(tx, a, c) {
    const { n, html, data, body } = await appOf(tx, c, a);
    if (!Array.isArray(a.steps) || !a.steps.length) throw new ToolError("steps is a list like [{ tap: \"Add\" }, { type: \"5\", into: \"Km\" }].");
    const real = a.data === "real";
    if (real) {
      const [p] = await tx<{ app_previews_real: boolean }[]>`select app_previews_real from public.profiles where user_id = ${c.ctx.userId}`;
      if (!p?.app_previews_real) throw new ToolError("Trying the app with real data is off. It uses a sample with the same shape by default (data: \"sample\"). The person can allow real data in Amber Notes › Settings › Apps in Notes.");
    }
    const t = today();
    const r = await render({ html, markdown: real ? body : sampleNote(body, t), data: real ? data : sampleData(data, t), today: t,
      views: [a.start === "desktop" ? { width: 1280, scheme: "light" } : { width: 390, scheme: "light" }], steps: a.steps.slice(0, 30), probes: false });
    if (typeof r === "string") return { app: { id: n.id, title: n.title }, tried: false, reason: r };
    const steps = r.trial ?? [];
    const which = a.screenshots ?? "last";
    const report = steps.map((s, i) => ({ step: i + 1, did: s.step, ...(s.ok ? {} : { failed: s.error }), ...(s.errors.length ? { errors: s.errors } : {}), ...(s.data.length ? { data_changed: s.data } : {}), screen: s.screen }));
    const blocks: Record<string, unknown>[] = [{ type: "text", text: JSON.stringify({ app: n.title, data: real ? "a copy of the person's data" : "a sample with the app's data shape", steps: report }, null, 2) }];
    steps.forEach((s, i) => {
      if (!s.png || which === "none" || (which === "last" && i !== steps.length - 1 && s.ok)) return;
      blocks.push({ type: "text", text: `After step ${i + 1}:` });
      blocks.push({ type: "image", data: s.png, mimeType: "image/png" });
    });
    return new Content(blocks, { app: { id: n.id, title: n.title }, steps: report });
  },

  async run_app_tests(tx, a, c) {
    const { n, html, data, body } = await appOf(tx, c, a);
    const t = today();
    const r = await render({ html, markdown: sampleNote(body, t), data: sampleData(data, t), today: t, tests: true });
    if (typeof r === "string") return { app: { id: n.id, title: n.title }, ran: false, reason: r };
    return { app: { id: n.id, title: n.title }, ...testSummary(r), ...(r.tests?.length || r.testErrors?.length ? {} : { note: "No tests yet: add files like tests/app.test.tsx." }) };
  },

  async resolve_package(_tx, a) {
    try { return await resolvePackage(String(a.name ?? "").trim(), typeof a.version === "string" && a.version.trim() ? a.version.trim() : undefined, typeof a.file === "string" && a.file.trim() ? a.file.trim() : undefined); } catch (e) { throw new ToolError((e as Error).message); }
  },

  async preview_app(tx, a, c) {
    const { n, html, data, body } = await appOf(tx, c, a);
    const widths = (Array.isArray(a.widths) && a.widths.length ? a.widths : [390, 1280]).map(Number).filter((w) => Number.isInteger(w) && w >= 320 && w <= 1800).slice(0, 3);
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
    const f = renderedFindings(r);
    const issues = [...f.errors, ...f.notes];
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
