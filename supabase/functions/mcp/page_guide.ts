// Note pages (prototype): what an AI is taught about building them (people call them the note's app). One source for the server's
// instructions, the tool descriptions, get_page_guide, the MCP prompts and resources, and the
// Claude skill (plugins/amber-notes/skills/note-pages, written from here by
// scripts/page-evals/build-skill.ts), so none of them drift.

import { MAX_PAGE_BYTES, MAX_PAGE_DATA_BYTES, PAGE_CONTRACT } from "./page.ts";
import { PAGE_TEMPLATES } from "./page_templates.gen.ts";
import { LIBRARY_GUIDE } from "./libraries.ts";

/** The few lines every client sees in the server's instructions. Clients differ in what else they
 *  read (resources, prompts, skills), so this and the tool descriptions carry the essentials. */
export const PAGE_INSTRUCTIONS = `Apps: a note can have an app side, a small HTML app (a habit grid, a budget, flashcards) next to its Text side. In tools it's the note's "page"; with the person always call it "the note's app" and the "App" side, never "page".
- Before making, redesigning or fixing an app, call get_page_guide once, then read_note and get_note_page.
- Libraries load by name, never pasted in: bundled ones (chart, d3, three, tone, dayjs, marked, purify, anime, confetti, topojson, world) in <meta name="amber-libs" content="chart, d3">, any other npm package as a pinned, hashed entry from resolve_package in the same meta.
- Every input, select and textarea is visible as a field in both themes: a solid fill and a 1px border (var(--amber-field), var(--amber-field-border)); never border: 0 or a transparent background.
- Design around the person's job with one focus per screen; use tabs, pushed screens and sheets for the rest (a training app opens on today's workout; plan and progress are other screens).
- Give each app its own form and look for its job (a bookshop shelf, a cool blue water gauge, a game board, a keypad), not a beige card with a list; Amber's tokens are the fallback. Keep text readable (4.5:1) in light and dark. Games and toys are welcome. It must work on an iPhone (320-440 pt) and in a Mac window (500-1400+ px).
- After creating or changing an app, run check_app (and preview_app if you can see images) and fix what they report before telling the person it's done.
- Data never needs the app rewritten: the note's tables and checklists change with add_table_rows, update_table_rows, delete_table_rows, edit_table_columns, add_checklist_items, update_checklist_items; the app's own data (values, collections of records, files) with get_page_data / update_page_data.
- API keys: apps declare the keys they need; list_api_keys shows which exist (never values). Walk the person through getting a key and adding it in Amber Notes › Settings › API Keys. Never ask for a key in the chat; if one is pasted, don't store or repeat it: tell them to add it in Settings.`;

const kb = (n: number) => (n >= 1048576 ? `${n / 1048576} MB` : `${n / 1024} KB`);

/** The contract the app keeps (page.ts, owned with the app's bridge), quoted in set_note_page and get_note_page. */
export const PAGE_API = `${PAGE_CONTRACT}
One self-contained HTML document, at most ${kb(MAX_PAGE_BYTES)}; the app's own data at most ${kb(MAX_PAGE_DATA_BYTES)}.`;

/** The guide get_page_guide returns, the MCP resource, and the skill's reference. Markdown. */
export const PAGE_GUIDE = `# Building apps in Amber Notes notes

A note can have an app: one HTML document shown on the note's App side, next to its Text side. A habit grid, a budget with totals, flashcards, a trip planner. In the tools it's called the note's page (set_note_page, get_note_page); when you talk to the person, call it "the note's app" or "the App side", and never "page" or "Pages".

The note's text stays the person's own data: they can always flip to Text and see and edit every row. The app reads it, changes it through checked edits, and keeps its own data (settings, logs, records, files) in a store next to it, never in the text. Replacing or removing an app never loses data: the last 10 versions are kept.

## The contract

${PAGE_API}

## Workflow

1. read_note: the text, its tables (columns, row count) and checklists.
2. Shape the data first, with the data tools, never inside the app's HTML:
   - The note has no table yet but the app needs rows the person will read: add_table_rows with create_table: true (and column_types like { "Date": "date", "Km": "number" }) makes the table and fills it in one call.
   - Messy notes ("Mon: ran 5k"): turn them into a table in the note first, keeping every fact, then build the app over the table.
   - Keep the columns the person already has. Rename only when asked, with edit_table_columns (it keeps every value). Never drop a column or rows to make an app simpler.
3. get_note_page: if the note has an app, read it before changing it. The result shows page_input (what your app will receive as amber.note) and the app's data.
4. Write the app:
   - new app or a full redesign: set_note_page with the whole HTML. Start from the closest template (get_page_guide with template).
   - a fix or a tweak (a color, a label, a bug, a new button): edit_note_page with exact find/replace edits copied from get_note_page.
5. Check it: check_app reports script errors, overflow at 390 px, small or low-contrast text, missing labels, theme use and network hosts. If your client shows images, preview_app shows you the app at phone and desktop widths in light and dark. Fix what they find (edit_note_page) and check again. Don't tell the person it's done before check_app is clean.
6. Data the person asks to add: rows for the note's tables with add_table_rows (rows or pasted csv, one call even for hundreds); records, settings and files for the app's own store with update_page_data (values, add, update, remove, import of csv, files). Changes and removals: update_table_rows / delete_table_rows take where with a value or a test ({ "Date": { "from": "2026-09-01", "to": "2026-09-30" } }, starts_with, contains, empty). None of this touches the app: it re-renders.
7. Reply in one or two lines: what the app does, and that it's on the note's App side.

## API keys

Some apps need a service that wants an API key (weather, stocks, translation). Keys live in Amber Notes › Settings › API Keys on the person's devices; the app adds a key to requests for the hosts it was declared for, and neither the app's HTML nor you ever see its value.

- Declare each key the app needs in amber-needs: { "name": "OpenWeather", "hosts": ["api.openweathermap.org"], "query": "appid={key}" } (or "header": "Authorization: Bearer {key}"), with "help": one line on where to get it. Call amber.fetch(url, { key: "OpenWeather" }) and show a clear message in the app when the key is missing or rejected.
- Call list_api_keys to see which key names exist and whether each is set (never values). Use the same name if one exists.
- Walk the person through it: which site to sign up on, whether there's a free plan and its limits, where the key is on that site after signing in, then "In Amber Notes, open Settings › API Keys, add a key named OpenWeather, and paste it there."
- Prefer services that need no key when they're good enough (api.open-meteo.com for weather), and say so.
- Never ask the person to paste a key into the chat. If they paste one anyway: don't repeat it, don't put it in the note, the app or its data, and don't use it. Tell them to add it in Settings › API Keys instead, and suggest they make a new key on the service, since this one has been in the chat.

## The title

The app owns the note's title. Nothing around the app shows it (not the App side, not a shared web page, not a widget), so the app's first heading is the note's title, read from amber.note.title so it follows renames, and it appears once. Don't add a second heading with the title or the app's kind ("Habit tracker" above "Habits"). A widget-sized app can use a compact header, still the title. check_app flags a missing or doubled title.

## Settings the person changes without you

Names, goals, limits, currencies, categories, the list of habits to track: declare them as settings instead of hardcoding them, so the person changes them in More › App Settings without asking an AI.

- Declare: <meta name="amber-settings" content='{"settings": [{ "key": "budget", "label": "Monthly budget", "type": "number", "default": 15000 }, { "key": "currency", "label": "Currency", "type": "currency", "default": "SEK" }, { "key": "categories", "label": "Categories", "type": "list", "default": ["Food", "Home", "Fun"] }]}'>. Types: text, number, choice (with "options"), list (of strings), color (#rrggbb), currency (a code like SEK). "help" adds a line under the field.
- Read amber.settings (defaults merged with what the person saved) inside your onChange render; onChange runs again when a setting changes. Values live in amber.data.values.settings: to set one for the person, update_page_data with values: { settings: { budget: 12000 } }.
- Settings aren't records: rows the person logs stay in the note's tables or the app's collections.

## Reading data robustly

- Find tables and columns by name, case-insensitively, not by position: \`const t = note.tables.find(t => t.columns.some(c => /^date$/i.test(c.name)))\`. Fall back gracefully when a column is missing (show an empty state that says which column to add), never throw.
- Cells are strings. Parse numbers leniently: \`parseFloat(s.replace(/\\s/g, "").replace(",", "."))\`, treat NaN as empty. Treat ✓, x, yes, done, 1, true as done.
- amber.data is there synchronously (amber.data.values, amber.data.collections, amber.settings); amber.store.get and the collection reads return promises, so await them or read amber.data. Never show "[object Promise]", "undefined" or "NaN": check_app flags them.
- Dates are "yyyy-mm-dd" strings; compare them as strings. Use amber.note.today, not the clock, for "today".
- Empty table or note: render a friendly empty state with what to add, not a blank page.
- Apps must handle 0 rows and 500 rows. Build HTML strings once per render, not per cell with appendChild in a loop.
- Escape every value from the note before putting it in HTML: \`const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c])\`. Notes contain <, &, quotes.
- Never hardcode the note's rows, totals or names in the HTML. The note changes; the app must follow.

## Changing data from the page

- Tick: amber.update({ op: "toggle_checklist", line: item.line }).
- Edit a cell: amber.update({ op: "set_cell", table: t.index, row: i, col: "Amount", value: "120" }).
- Add a row: amber.update({ op: "append_row", table: t.index, values: { Date: amber.note.today, Item: "Coffee", Amount: "4" } }).
- Add a checklist item: amber.update({ op: "add_checklist_item", text: "Sunscreen", under_heading: "Clothes" }). Keep checklists as checklists; never turn them into a table so the app can add to them.
- Check the result: if !r.ok show r.error next to the control. Don't update your own state optimistically for table data; onChange fires with the new note right after a successful update.
- Give every input a stable id or name: when a new version of the app arrives while it's in use, the person switches to it and what they typed carries over by id or name.
- Write values the way the note already writes them (✓ vs x, "4" vs "4.00", the same date format).
- Where data lives: records the person reads or edits as text (expenses, runs, contacts, a reading list) go in a table or checklist in the note, so they're visible under Text and work with every tool. The page's own data (amber.data) holds what isn't text: settings and goals (amber.store.set), a flashcard schedule, the chosen view, and app-only records such as timed sets or photo logs (collections). Don't copy table rows into data.
- Things the person should be able to change without you (a budget limit, a goal, their name, categories, a currency) are settings: declare them in <meta name="amber-settings"> and read amber.settings. Amber Notes shows them under App Settings.
- Put data into the app's store from here with update_page_data (values, add, update, remove, import, files); query it with get_page_data (a collection, a where, a limit).

## Design: each app has its own look

Every app should look like it was made for what it does, in form and in character. A reading log can feel like a bookshop, a water tracker cool and blue, a game bold, a budget calm and precise. Amber's tokens are the fallback when you have no better idea, not the default look.

- Pick a palette for the app: a background tint or none, one accent, and one or two supporting colors that suit its subject. Pick type that suits it too: size, weight, rounded (--amber-font-rounded) or mono (--amber-font-mono) where it fits, generous or dense spacing. Shapes can be your own: big dials, full-bleed bands, a board, a shelf of spines.
- Readable and dark mode, always: body text at 4.5:1 contrast or better against what's behind it, in light and dark. Define your colors as CSS variables on :root and give each a dark variant in @media (prefers-color-scheme: dark) (lighter accents, deeper backgrounds). Test both; check_app measures contrast in both.
- Don't set a background on html or body (the note's background shows there); put your background on the app's own container. --amber-text, --amber-bg and the rest stay useful as a base and for anything you don't restyle.
- Pick the form from the job. A habit tracker can be a wall of days, a garden that grows, or a ring per habit. A budget can be a dial or a stacked bar over the month. A calculator is a keypad with a big display. A vocabulary note can be a game. Use type scale, space, grids, canvas and SVG, with motion where it explains something.
- Still: one clear focus first, then details. Readable text (at least 12 px, contrast 4.5:1), tabular-nums for numbers, no emoji as icons (inline SVG), no motion that loops for nothing; respect prefers-reduced-motion.
- Fields look like fields: every input, select and textarea has a solid fill and a 1px border in both themes. The app gives them background: var(--amber-field) and border: 1px solid var(--amber-field-border) by default; restyle them if you like, but never remove the border or make them see-through. Use solid colors (no translucent panels).
- Accessibility: real <button>s and <input>s; every input has a <label> (or aria-label); icon-only buttons have aria-label; state that is shown by color is also shown another way; canvas and SVG views get role="img" and an aria-label, or a text equivalent; lang on <html>.
- Keep it small: most good apps are 6-30 KB of HTML; libraries load by name and don't count (see Libraries).

## Focus and structure

Design around the person's job, with one focus per screen. Ask what they open the app to do most often, and make that the first screen; everything else lives one step away.

- A training app opens on today's workout. Plan editing and progress are their own screens, not sections stacked under it. A budget opens on "how much is left this month" and the add button; categories and history are a tap away. A reading log opens on what you're reading now.
- Real app structure is welcome: tabs (a bottom tab bar on iPhone, a sidebar or top tabs on a wide Mac window), pushed detail screens with a back button, sheets for adding or editing, and segmented controls to switch views. Keep it shallow: 2 to 5 places, each with one job.
- Keep the current screen in the app's store (amber.store.set("screen", …)) so the app reopens where the person was, and in history (history.pushState) only if you handle the back gesture yourself.
- On the first screen: one primary action, one or two key numbers, then a short list or view. If you're stacking more than four independent sections (a summary, a chart, a form, a history, settings…) on one screen, split them into screens or tabs. check_app warns when a screen holds too many.
- Navigation controls are real buttons with labels (aria-current on the active tab), at least 44 pt, and the active place is obvious.

## Sizes

You own the layout at every size; the app must work and look intended across the whole range, with no sideways scrolling.

- The app's web view is its real size, with viewport-fit=cover, so env(safe-area-inset-*) works; resizing and the keyboard behave the standard web way.
- iPhone: 320-440 pt wide, portrait and landscape (up to about 930 pt wide in landscape, short height), safe areas at the edges, and the keyboard covering the bottom half while someone types.
- Mac: a note window from about 500 to 1,400+ px wide, resized live. Use the room on wide windows: a 400 px column floating in a 1,280 px window is a phone layout stretched, not a design.
- Embedded in another note (a sub-note shown inside its parent): a short strip, often 300-700 px wide; <html data-amber-context="widget"> (and the class amber-widget) and amber.context = { embedded, width, height } tell you. Keep a compact form that still makes sense there (the title, the one number or control that matters).
- Text sizes in rem: on iPhone the root follows the reader's text size, so the layout must hold at larger text too.
- Touch targets at least 44 pt on iPhone. Hover only as an extra on Mac, never the only way. Keyboard shortcuts are welcome on Mac (and for games).
- Use what fits: CSS grid and flex with wrapping, container queries (container-type: inline-size; @container (min-width: …)), clamp() for type, and media queries. The app also sets the classes amber-narrow / amber-medium / amber-wide on <html> (under 600, to 900, from 900 px) as a convenience; don't rely on them.
- check_app renders at 375, 768 and 1,280 px (and the widget strip for sub-notes) and reports overflow, clipped text, small targets on the phone and an empty wide window.

## Libraries

${LIBRARY_GUIDE}

## Games, toys and fun

Fun is welcome: a game from a vocabulary note, a habit tracker that feels like a game, a drum machine whose pattern lives in the note, a 3D toy. Game basics:

- An animation loop with requestAnimationFrame, time-based (use the frame's timestamp, not a fixed step per frame), drawn on a canvas sized to its container times devicePixelRatio.
- Controls for touch and keyboard: pointer events (pointerdown/move/up) for taps and drags, keys for Mac. Big touch areas; no hover.
- Pause when hidden (document.visibilityState, a Pause button) and when the person switches to Text.
- Keep high scores, progress and game state in the app's store (amber.store.set, collections), so it survives closing the app; content to play with comes from the note.
- Sound only after a tap (audio can't start on its own); a mute button; keep it short and quiet.
- Make it start right away, show how to play in one line, and give a way to restart.

## Never

- No direct network: no fetch()/XHR, no external URLs in src/href (not even in comments), no <link>, no @import, no web fonts. The app is refused if it has them; it couldn't load them anyway. Live data (prices, weather) only through amber.fetch to hosts declared in amber-needs, which the person approves once (see API keys).
- No localStorage/sessionStorage/IndexedDB/cookies: the sandbox doesn't keep them. Use amber.store.
- No alert/confirm/prompt dialogs: show inline messages.
- Don't copy the note's rows into the app's HTML or its data to edit them there: change the note through amber.update or the data tools.

## Starter

A minimal correct page to build from:

\`\`\`html
${"<!doctype html>"}
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { box-sizing: border-box; }
  main { max-width: var(--amber-content-max); margin: 0 auto; padding: 20px var(--amber-gutter) 96px; }
  h1 { font-size: 28px; letter-spacing: -.02em; margin: 4px 0 16px; }
  .card { background: var(--amber-surface); border-radius: var(--amber-radius); border: 1px solid var(--amber-separator); margin-bottom: 16px; overflow: hidden; }
  .row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-top: 1px solid var(--amber-separator); min-height: 48px; }
  .row:first-child { border-top: 0; }
  .grow { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .muted { color: var(--amber-text-secondary); font-size: 14px; }
  .num { font-variant-numeric: tabular-nums; font-weight: 600; }
  form { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--amber-text-secondary); flex: 1 1 120px; }
  input, select { font: inherit; color: var(--amber-text); background: var(--amber-fill); border: 0; border-radius: var(--amber-radius-small); padding: 10px 12px; min-height: 44px; width: 100%; }
  button { font: inherit; font-weight: 600; min-height: 44px; padding: 0 16px; border: 0; border-radius: var(--amber-radius-small); background: var(--amber-accent); color: var(--amber-on-accent); }
  .err { color: var(--amber-danger); padding: 0 16px 12px; min-height: 1em; }
  .empty { padding: 28px 16px; text-align: center; color: var(--amber-text-secondary); }
</style>
</head>
<body>
<main id="app" aria-live="polite"></main>
<script>
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const col = (t, re) => t.columns.findIndex((c) => re.test(c.name));
  let error = "";

  function render(note, data) {
    const app = document.getElementById("app");
    const t = note.tables.find((t) => col(t, /^(item|name|title)$/i) >= 0);
    if (!t) { app.innerHTML = \`<h1>\${esc(note.title)}</h1><div class="card empty">Add a table with an Item column to the note to see it here.</div>\`; return; }
    const item = col(t, /^(item|name|title)$/i);
    app.innerHTML = \`
      <h1>\${esc(note.title)}</h1>
      <div class="card">\${t.rows.length ? t.rows.map((r) => \`<div class="row"><div class="grow">\${esc(r[item])}</div></div>\`).join("") : '<div class="empty">Nothing yet.</div>'}</div>
      <div class="card">
        <form id="add"><label>New item<input name="v" required></label><button>Add</button></form>
        <div class="err" role="alert">\${esc(error)}</div>
      </div>\`;
    document.getElementById("add").onsubmit = async (e) => {
      e.preventDefault();
      const v = new FormData(e.target).get("v").trim();
      const r = await amber.update({ op: "append_row", table: t.index, values: { [t.columns[item].name]: v } });
      error = r.ok ? "" : r.error;
      if (!r.ok) render(amber.note, amber.data);
    };
  }
  amber.onChange(render);
</script>
</body>
</html>
\`\`\`

## Templates

Tested, complete pages to start from (get_page_guide with template: "<name>" returns one). Adapt column names to the note's, never the note to the template, unless the note has no table yet.
${PAGE_TEMPLATES.map((t) => `- ${t.name}: ${t.description} Expects: ${t.expects}`).join("\n")}
`;

/** MCP prompts: starting points a client can offer the person. */
export const PAGE_PROMPTS = [
  {
    name: "make_app",
    title: "Make this note an app",
    description: "Give a note an app: a tracker, a budget, flashcards, a planner, over the note's data.",
    arguments: [{ name: "note", description: "The note's title or id.", required: true }, { name: "idea", description: "What the page should do, if you have something in mind.", required: false }],
    text: (a: Record<string, string>) => `Make my note "${a.note}" an app${a.idea ? `: ${a.idea}` : ""}. Call get_page_guide first, then read the note, shape its data into tables if needed (keeping every fact), build the app with set_note_page and run check_app. Tell me what it does in a line or two.`,
  },
  {
    name: "add_data",
    title: "Add data to a note",
    description: "Add rows or items to a note's table or checklist, from text, a list or pasted CSV.",
    arguments: [{ name: "note", description: "The note's title or id.", required: true }, { name: "data", description: "The rows or items, in any form (CSV, a list, prose).", required: true }],
    text: (a: Record<string, string>) => `Add this to my note "${a.note}". Read the note (and its app's data with get_page_data) first, use the existing columns, fields and value formats, and add it with add_table_rows, add_checklist_items or update_page_data. Don't change the app itself.\n\n${a.data}`,
  },
  {
    name: "change_app",
    title: "Change a note's app",
    description: "Change how a note's app looks or works, without touching its data.",
    arguments: [{ name: "note", description: "The note's title or id.", required: true }, { name: "change", description: "What to change.", required: true }],
    text: (a: Record<string, string>) => `Change the app of my note "${a.note}": ${a.change}. Call get_page_guide, read the note and its app (get_note_page) first. Keep the note's data and columns exactly as they are; use edit_note_page for small changes and set_note_page for a full redesign, then run check_app.`,
  },
] as const;

export const GUIDE_URI = "amber://guides/note-pages";
export const templateUri = (name: string) => `amber://page-templates/${name}`;
