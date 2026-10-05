<!-- Generated from supabase/functions/mcp/page_guide.ts by scripts/page-evals/build-skill.ts. Don't edit. -->
# Building apps in Amber Notes notes

A note can have an app: one HTML document shown on the note's App side, next to its Text side. A habit grid, a budget with totals, flashcards, a trip planner. In the tools it's called the note's page (set_note_page, get_note_page); when you talk to the person, call it "the note's app" or "the App side", and never "page" or "Pages".

The note's text stays the person's own data: they can always flip to Text and see and edit every row. The app reads it, changes it through checked edits, and keeps its own data (settings, logs, records, files) in a store next to it, never in the text. Replacing or removing an app never loses data: the last 10 versions are kept.

## The contract

The page runs in Amber Notes in a sandbox with no network: no fetch, no external scripts, styles, fonts or images. Put all CSS and JS inline; images only as data: URIs or inline SVG.
Read the note from window.amber.note, never hardcode its contents (the note changes; the page must follow):
  amber.note = { title, markdown, today: "yyyy-mm-dd", tables: [{ index, columns: [{ name, type }], rows: [[cell, ...], ...] }], checklists: [{ line, text, checked }] }
  amber.onChange(fn) calls fn(note) right away and again with fresh data after every change, the page's own included. Render from it.
Change the note only through amber.update(op), which returns a Promise of { ok: true } or { ok: false, error }:
  { op: "toggle_checklist", line }            line from amber.note.checklists
  { op: "set_cell", table, row, col, value }  table index, row index (0-based, header excluded), col index or column name; plain one-line text
  { op: "append_row", table, values }         values: { columnName: text } or [text, ...]
  { op: "delete_row", table, row }  { op: "move_row", table, from, to }
  { op: "set_text", heading, text }            replaces the text under that heading (up to the next heading of the same level)
  { op: "add_checklist_item", text, under_heading? }  a new open "- [ ] text" after the last open item of that checklist (keep checklists as checklists)
  { op: "add_column", table, name, type?, after? }  { op: "rename_column", table, col, to }
  amber.update([op, op, ...]) applies several as ONE change with one Undo (all or nothing): use it for a workout's sets, imported rows, a grocery run. Each op sees the note as the ones before it left it (lines move down after added rows).
Each change lands in the note's markdown as a normal edit the person can see and undo. Changes to the app's own data are quiet (no receipt): use the data for app state.
The page's own data (not the note's text; for state the person wouldn't type, like settings, logs, a schedule): amber.data = { values, collections };
  amber.store.get(key) / amber.store.set(key, value); amber.store.collection(name).list() / query(fn) / get(id) / add(fields) -> { id } / update(id, patch) / remove(id); amber.setData(mergePatch).
  amber.onChange(fn) passes (note, data). Up to 4 MB. Files: amber.files.save({ name, type, base64 }) -> { file: { $file, ... } }; keep the ref in a record and show it with amber.files.url(ref, { width }) as an <img>/<audio>/<video> src (instant, no data: URLs in the data); amber.files.read(ref) -> { dataURL } when you need the bytes.
The device, through the system's own prompts (results go to the page only; write to the note explicitly if wanted): amber.device.reminders.create({ title, due, repeat: "daily" }), calendar.today() -> { events: [{ title, start, end, location, attendees }] },
  notify({ title, body, at | in }) -> { id }, notify.cancel(id), reminders.complete(id) / reminders.delete(id) (only ones an app made), openURL(url), photos.pick({ limit }) / camera.take() -> { files: [{ $file, thumb }] }, contacts.pick() -> { contact: { name, organization, emails, phones, addresses, birthday?, photo? } }, files.pick(), location.once() -> { lat, lon, place },
  maps.open({ lat, lon | query, directions }), maps.snapshot({ lat, lon, km | pins: [{ lat, lon, label }], fit, pin, width, height, dark }) -> { dataURL, region, points: [{ x, y }] } (points: where each pin landed, to draw on top). On-device AI: amber.ai.available(), amber.ai.respond(prompt, { instructions }) -> { text }. Every call returns { ok, ... } or { ok: false, error }.
Settings: the app draws its own (a settings screen or sheet inside the app, in its own style) and keeps them in amber.data or the store, with defaults in the code. Use settings for names, goals, limits, currencies and categories instead of hardcoding them. There is no native settings form; More › App Info is only for the internet, Previous App and Remove App.
Libraries: Amber Notes ships chart (Chart.js 4.4.4 → Chart), d3 (7.9.0 → d3), three (0.160.0 → THREE), tone (14.8.49 → Tone), dayjs (1.11.13), marked (12.0.2), purify (DOMPurify 3.1.6, use it on marked output),
  anime (3.2.2), confetti (canvas-confetti 1.9.3), topojson (topojson-client 3.1.0), world (country shapes, TopoJSON → worldAtlas110m).
  For a real application with several screens and state, use Preact without a build step: preact (10.24.3 → preact), preact-hooks (→ preactHooks), htm (3.1.1 → htm), router (Amber Notes, 1 kB → amberRouter: <Router> with path="/item/:id", <a href="#/add">, route(), back(); kept in memory, the page cannot navigate).
  <meta name="amber-libs" content="preact, preact-hooks, htm, router"> (what a library needs is loaded first), then const html = htm.bind(preact.h); const { useState } = preactHooks; preact.render(html`<${App} />`, document.body). Declare them: <meta name="amber-libs" content="chart, d3">, loaded before your scripts as those globals; or await amber.lib("three").
  Any other npm package: npm:name@1.2.3/path/to/file.min.js#sha384-<base64> in the same meta (a pinned version and an SRI hash, sha256/384/512); Amber Notes downloads it once from cdn.jsdelivr.net, checks the hash, keeps it on the device. Never paste a library into the page.
Where the app is: amber.context = { embedded, width, height }; <html data-amber-context="widget|full">. The web view is the app's real size, with safe areas (env(safe-area-inset-*), also --amber-safe-*). On iPhone the keyboard shrinks the web view (innerHeight and visualViewport both), so a position: fixed; bottom: 0 bar or sheet sits right above it; --amber-keyboard stays 0. Keep bottom bars and pinned buttons above Amber's own things with padding-bottom: max(var(--amber-safe-bottom), var(--amber-inset-bottom)) (amber.insets.bottom; the amber:insets event when it changes).
An app can also be a project of files (written by the file tools): /index.html, /src/main.jsx, /src/App.jsx, /src/screens/, /src/components/, /src/styles.css (linked from index.html), /src/data.js, README.md. JSX/TSX is compiled when written (automatic runtime, jsxImportSource preact). Modules import bare names (no amber-libs meta, no globals): preact, preact/hooks, amber, amber-router, amber-ui, htm, and the other bundled libraries by npm name as a default export (import Chart from "chart.js").
  "amber": useNote() (the live note), useTable("Log") (by the heading above it, or a column name; never by position) -> { rows: [{ id, ...values by column }], columns, found, add(values), update(id, patch), remove(id), move(id, to) }, useChecklist("Packing") -> { items: [{ id, text, checked }], toggle(id), add(text), remove(id) }, useAppData(key, initial) -> [value, set] (kept in the app's data), useSettings(defaults) -> [settings, update(patch)], batch(async () => { ... }) (one change, one Undo), and device, ai, files, fetch.
  "amber-router": Router, Route (<Route path="/plan/:day" component={PlanDay} />), Link, route(path), back(), useRoute(); links as <a href="#/plan">.
  "amber-ui": Button, Card, List, ListRow, Input, TextArea, Select, Toggle, Slider, Stat, EmptyState, Sheet, Dialog, Tabs, TabBar, Shell, Toast, toast, Icon. Files are served from amber-app:///; fetch("/src/data.json") works for the app's own files. At most 200 files, 512 KB each, 3 MB in all.
Network: the page itself can't reach anything. Declare hosts ("*.archive.org" covers its servers, for services that redirect to numbered hosts) in <meta name="amber-needs" content='{"hosts": ["api.open-meteo.com"], "keys": [{ "name": "OpenWeather", "hosts": ["api.openweathermap.org"], "query": "appid={key}", "help": "How to get one" }]}'>
  and call amber.fetch(url, { method, headers, body, key }) -> { ok, status, body }. The person approves each host once and sees every request; with key, the app adds that API key (the page never sees it). Redirects are followed only to declared, approved hosts.
Look like Amber Notes: every app starts with two stylesheets, loaded before its own: amber-tokens.css (these variables, already switched for light and dark) and amber-base.css (body font, colours and background, visible fields, links, no sideways overflow; get_page_guide shows its full text). Both are in cascade layers (amber-tokens, amber-base), so any style you write wins over them whatever its specificity; override freely. <meta name="amber-base" content="none"> drops amber-base.css and keeps the variables. Use the variables instead of your own colours and fonts:
  --amber-bg (the note's background), --amber-surface (cards and grouped rows), --amber-fill (controls, empty cells), --amber-text, --amber-text-secondary, --amber-separator,
  --amber-accent (amber, for marks and filled controls), --amber-accent-text (amber for text), --amber-accent-soft (a soft amber fill), --amber-on-accent (text on --amber-accent),
  --amber-danger, --amber-field and --amber-field-border (inputs), --amber-radius (cards), --amber-radius-small (controls), --amber-font (the system font), --amber-font-rounded, --amber-font-mono, --amber-content-max, --amber-gutter.
Every input, select and textarea is visible as a field in both themes: a solid fill and a 1px border (inputs get background: var(--amber-field); border: 1px solid var(--amber-field-border) by default; don't remove them). Nothing see-through: solid colours only.
Size text in rem: on iPhone the root follows the reader's text size. In a parent note the app can show as a small widget: <html> then has the class amber-widget; use a compact layout.
Fit every width: the page fills the note, from 320 px on a small iPhone to 1,800 px in a full-screen Mac window, and re-lays out live as the window resizes. Put content in a container with max-width: var(--amber-content-max) (1100 px), margin: 0 auto and side padding var(--amber-gutter). Use one column under 600 px, and from 900 px use the room (side-by-side sections, more history, bigger numbers) with @media (min-width: 900px) or the classes amber-narrow / amber-medium / amber-wide the app keeps on <html>. Never a fixed width, never a stretched phone layout. 
One self-contained HTML document, at most 256 KB; the app's own data at most 4 MB.

## Workflow

1. read_note: the text, its tables (columns, row count) and checklists, and the headings they sit under.
2. Shape the data first, with the data tools, never inside the app:
   - The note has no table yet but the app needs rows the person will read: add_table_rows with create_table: true (and column_types like { "Date": "date", "Km": "number" }, and under_heading: "Log") makes the table under a heading and fills it in one call. Give every table and checklist a heading: the app finds it by that name.
   - Messy notes ("Mon: ran 5k"): turn them into a table in the note first, keeping every fact, then build the app over the table.
   - Keep the columns the person already has. Rename only when asked, with edit_table_columns (it keeps every value). Never drop a column or rows to make an app simpler.
3. If the note has an app, list_app_files and read its README.md first, then the files you'll change.
4. A new app: create_app, then make it yours. It's a normal small Preact project (see The project): decide the job in one sentence and the screens, then write screens and components with write_app_file and change files with edit_app_file. Keep README.md current.
5. Every write answers with what to fix: a compile error (the write is refused), imports that point at nothing, the project's style (window.amber instead of the hooks, a table by position), and what a browser saw at 390 and 1280 px. Fix as you go. Pass look: true now and then to see it (if your client shows images).
6. When it's done: check_app (and preview_app if you can see images) for the full checks at 375, 768 and 1280 px in light and dark, with an empty and a 400-row note. Don't tell the person it's done before check_app is clean.
7. Data the person asks to add: rows for the note's tables with add_table_rows (rows or pasted csv, one call even for hundreds); records, settings and files for the app's own data with update_page_data. Changes and removals: update_table_rows / delete_table_rows take where with a value or a test ({ "Date": { "from": "2026-09-01", "to": "2026-09-30" } }, starts_with, contains, empty). None of this touches the app: it re-renders.
8. Reply in one or two lines: what the app does, and that it's on the note's App side.

## The project

A note's app is a small web project, and you work on it the way you would on any codebase: read before you change, small focused files, one component per file, names that say what things are. It starts from create_app:

```
/README.md
/index.html
/src/App.jsx
/src/data.js
/src/main.jsx
/src/screens/Home.jsx
/src/screens/Settings.jsx
/src/styles.css
```

- /index.html links /src/styles.css and loads /src/main.jsx as a module; main.jsx renders App. JSX, TSX and TS are compiled when you write them; plain .js and .css are served as they are. Put screens in /src/screens/, pieces used in several places in /src/components/, helpers and defaults in /src/data.js.
- Import by bare name: preact, preact/hooks, amber, amber-router, amber-ui, and the bundled libraries by their npm names (import Chart from "chart.js", import d3 from "d3": each library's global is its default export). Relative imports between your files ("../components/SetRow.jsx"). No import map of your own, no URLs, no globals.
- "amber" is the note and the app's data as hooks:
  - const note = useNote(): { title, today, markdown, tables, checklists }, live.
  - const log = useTable("Log"): the table under the heading Log (or one with a column named Log): { found, columns, rows: [{ id, Date, Exercise, … }], add(values), update(id, patch), remove(id), move(id, to) }. Always by name, never by position.
  - const packing = useChecklist("Packing"): { items: [{ id, text, checked }], toggle(id), add(text), remove(id) }.
  - const [plan, setPlan] = useAppData("plan", []): like useState, kept in the app's own data (synced, never in the note's text).
  - const [settings, update] = useSettings({ unit: "kg", goal: 3 }): settings with their defaults; update({ goal: 4 }).
  - batch(async () => { await log.add(a); await log.add(b); }): several note edits as one change with one Undo.
  - Also device, ai, files and fetch (for hosts declared in amber-needs).
- "amber-router": <Router>, <Route path="/plan/:day" component={PlanDay} />, route("/plan"), back(), useRoute(); links as <a href="#/plan">. The screen is kept in memory (the app can't navigate).
- "amber-ui": Button, Card, List, ListRow, Input, TextArea, Select, Toggle, Slider, Stat, EmptyState, Sheet, Dialog, Tabs, TabBar, Shell, Toast, toast, Icon. Shell gives an app with several screens its frame: a tab bar on iPhone, a sidebar from 900 px. Every component is in the amber-ui layer, so your CSS wins; to change one deeply, copy its source (get_page_guide with kit: "Sheet") into /src/components/ and import yours.
- README.md: what the app is for, its screens and files, and where its data lives (which tables and checklists by heading, which app data keys). The next AI reads it first; keep it current when you add a screen or change where data lives.
- A one-file app (a single /index.html with an inline script) is only for something truly tiny. It can still use the same imports in <script type="module">, without JSX (htm).

## API keys

Some apps need a service that wants an API key (weather, stocks, translation). Keys live in Amber Notes › Settings › API Keys on the person's devices; the app adds a key to requests for the hosts it was declared for, and neither the app's HTML nor you ever see its value.

- Declare each key the app needs in amber-needs: { "name": "OpenWeather", "hosts": ["api.openweathermap.org"], "query": "appid={key}" } (or "header": "Authorization: Bearer {key}"), with "help": one line on where to get it. Call fetch(url, { key: "OpenWeather" }) with fetch imported from "amber" and show a clear message in the app when the key is missing or rejected.
- Call list_api_keys to see which key names exist and whether each is set (never values). Use the same name if one exists.
- Walk the person through it: which site to sign up on, whether there's a free plan and its limits, where the key is on that site after signing in, then "In Amber Notes, open Settings › API Keys, add a key named OpenWeather, and paste it there."
- Prefer services that need no key when they're good enough (api.open-meteo.com for weather), and say so.
- Never ask the person to paste a key into the chat. If they paste one anyway: don't repeat it, don't put it in the note, the app or its data, and don't use it. Tell them to add it in Settings › API Keys instead, and suggest they make a new key on the service, since this one has been in the chat.

## The title

The app owns the note's title. Nothing around the app shows it (not the App side, not a shared web page, not a widget), so the first screen's first heading is the note's title, from useNote().title so it follows renames, and it appears once. Other screens head with their own name (Plan, Progress, Settings). Don't add a second heading with the title or the app's kind ("Habit tracker" above "Habits"). check_app flags a missing or doubled title.

## Settings, inside the app

Names, goals, limits, currencies, categories, the habits to track: the person should change them without asking an AI, in the app itself. Settings are part of the app's design, not an afterthought.

- One obvious place: a Settings screen in the tab bar or sidebar of an app with screens, or a gear that opens a Sheet in a one-screen app.
- Sensible defaults in code (DEFAULTS in /src/data.js), so the app works before anyone opens settings; changes apply instantly (no Save button), with labelled fields (amber-ui Input, Select, Toggle, Slider).
- const [settings, update] = useSettings(DEFAULTS). They're kept in the app's data as values.settings; an AI sets them for the person with update_page_data { values: { settings: { goal: 4 } } }.
- Settings aren't records: rows the person logs stay in the note's tables or the app's own data.
- There is no native settings form: <meta name="amber-settings">, amber.settings and amber.openSettings() are gone (check_app flags them).

## Reading data robustly

- Find tables and checklists by name: useTable("Log") is the table under the heading Log, or the one with a column called Log. When found is false, show an empty state that says what to add ("Add a table under a Log heading with Date, Exercise and Kg"), never throw.
- Read columns by the names the note uses (row.Date, row["Weight (kg)"]); if a name might differ, look it up case-insensitively in columns.
- Cells are strings. Parse numbers leniently: `parseFloat(s.replace(/\s/g, "").replace(",", "."))`, treat NaN as empty. Treat ✓, x, yes, done, 1, true as done.
- Never show "[object Promise]", "undefined" or "NaN": check_app flags them.
- Dates are "yyyy-mm-dd" strings; compare them as strings. Use useNote().today, not the clock, for "today".
- An empty note, table or list gets a friendly empty state (amber-ui EmptyState) with what to add.
- Apps must handle 0 rows and 500 rows: compute in useMemo, render lists with keys.
- JSX escapes text for you; never use dangerouslySetInnerHTML with the note's text.
- Never hardcode the note's rows, totals or names. The note changes; the app must follow.

## Changing data from the app

- Tick: packing.toggle(item.id). Add an item: packing.add("Sunscreen") (it goes under that checklist's heading). Keep checklists as checklists; never turn them into a table so the app can add to them.
- Add a row: log.add({ Date: note.today, Exercise: "Squat", Kg: "80" }). Edit: log.update(row.id, { Kg: "82.5" }). Remove: log.remove(row.id). A row's id is its position when you read it: use it in the same render.
- Several edits for one action (log a whole workout): batch(async () => { … }), so it's one Undo.
- Each returns { ok, error }: show the error next to the control when ok is false. Don't keep your own copy of table data; the hooks re-render with the new note right after a change.
- Give every input a stable id or name: when a new version of the app arrives while it's in use, the person switches to it and what they typed carries over by id or name.
- Write values the way the note already writes them (✓ vs x, "4" vs "4.00", the same date format).
- Where data lives: records the person reads or edits as text (expenses, runs, contacts, a reading list) go in a table or checklist in the note, so they're visible under Text and work with every tool. The app's own data (useAppData, useSettings) holds what isn't text: settings and goals, a flashcard schedule, a workout in progress, scores. Don't copy table rows into the app's data.
- Put data into the app's own data from here with update_page_data (values, add, update, remove, import, files); query it with get_page_data.

## Design: each app has its own look

Every app should look like it was made for what it does, in form and in character. A reading log can feel like a bookshop, a water tracker cool and blue, a game bold, a budget calm and precise. Amber's tokens are the fallback when you have no better idea, not the default look.

- Pick a palette for the app: a background tint or none, one accent, and one or two supporting colors that suit its subject. Pick type that suits it too: size, weight, rounded (--amber-font-rounded) or mono (--amber-font-mono) where it fits, generous or dense spacing. Shapes can be your own: big dials, full-bleed bands, a board, a shelf of spines.
- Readable and dark mode, always: body text at 4.5:1 contrast or better against what's behind it, in light and dark. Define your colors as CSS variables on :root and give each a dark variant in @media (prefers-color-scheme: dark) (lighter accents, deeper backgrounds). Test both; check_app measures contrast in both.
- Don't set a background on html or body (amber-base.css gives body the note's background); put your background on the app's own container. The --amber-* variables stay useful as a base and for anything you don't restyle.
- Pick the form from the job. A habit tracker can be a wall of days, a garden that grows, or a ring per habit. A budget can be a dial or a stacked bar over the month. A calculator is a keypad with a big display. A vocabulary note can be a game. Use type scale, space, grids, canvas and SVG, with motion where it explains something.
- Still: one clear focus first, then details. Readable text (at least 12 px, contrast 4.5:1), tabular-nums for numbers, no emoji as icons (inline SVG), no motion that loops for nothing; respect prefers-reduced-motion.
- Fields look like fields: every input, select and textarea has a solid fill and a 1px border in both themes. amber-base.css gives them that (see The default look); restyle them in your own colours if you like, but never remove the border or make them see-through. Use solid colors (no translucent panels).
- Accessibility: real <button>s and <input>s; every input has a <label> (or aria-label); icon-only buttons have aria-label; state that is shown by color is also shown another way; canvas and SVG views get role="img" and an aria-label, or a text equivalent; lang on <html>.
- Keep it small: most good apps are 6-30 KB of HTML; libraries load by name and don't count (see Libraries).

## The default look: amber-base.css

Every app gets two stylesheets before its own. amber-tokens.css defines the variables (--amber-bg, --amber-surface, --amber-fill, --amber-text, --amber-text-secondary, --amber-separator, --amber-field, --amber-field-border, --amber-accent, --amber-accent-text, --amber-accent-soft, --amber-on-accent, --amber-danger, --amber-radius, --amber-radius-small, --amber-content-max, --amber-gutter, --amber-root-font, --amber-font, --amber-font-rounded, --amber-font-mono, --amber-safe-top, --amber-safe-right, --amber-safe-bottom, --amber-safe-left, --amber-inset-bottom, --amber-keyboard), already switched for light and dark and for iPhone or Mac. amber-base.css is the default look, and this is the whole file, exactly as the app ships it:

```css
/* amber-base.css, version 1 (Amber Notes). The default stylesheet every note's app gets.
   It is loaded before the app's own styles, inside the cascade layer "amber-base", so any style the
   app writes wins over it, whatever its specificity. There is nothing else: no other styles are
   added to an app, and no rule here is marked important.
   The colours and sizes are variables from amber-tokens.css (loaded first, layer "amber-tokens"),
   already switched for light and dark. To style everything yourself:
     <meta name="amber-base" content="none">   keeps amber-tokens.css, drops this file. */

@layer amber-tokens, amber-base;

@layer amber-base {
  /* Page: the note's background, the system font at the reader's text size (iPhone: Dynamic Type,
     so rem follows it; Mac: 14px). */
  html { font: var(--amber-root-font); -webkit-text-size-adjust: 100%; color-scheme: light dark; }
  body { margin: 0; font-size: 1rem; line-height: 1.35; background: var(--amber-bg); color: var(--amber-text); font-family: var(--amber-font); }

  /* Never wider than the note: something too wide is clipped, not panned to. */
  html, body { overflow-x: clip; }
  :where(img, video, canvas, svg, iframe, pre) { max-width: 100%; }

  /* Fields: every input visible as a field, in both themes. */
  :where(input:not([type=checkbox], [type=radio], [type=range], [type=color], [type=file], [type=hidden]), select, textarea) {
    background: var(--amber-field); color: var(--amber-text); border: 1px solid var(--amber-field-border);
    border-radius: var(--amber-radius-small); font: inherit; padding: 6px 10px;
  }
  :where(input, select, textarea, button, a):focus-visible { outline: 2px solid var(--amber-accent); outline-offset: 1px; }
  :where(input[type=checkbox], input[type=radio], input[type=range], progress) { accent-color: var(--amber-accent); }

  /* Buttons: the app's font; the rest is up to the app. */
  :where(button) { font: inherit; color: inherit; }

  /* Links and lines. */
  :where(a) { color: var(--amber-accent-text); }
  :where(hr) { border: 0; border-top: 1px solid var(--amber-separator); margin: 16px 0; }
}
```

That is all the styling an app is given; there is nothing hidden. Treat it as a starting point:
- Override any of it by just writing your rule. Both files are in cascade layers, so your styles win whatever their specificity: never use !important (check_app flags it).
- Opt out of all of it with <meta name="amber-base" content="none"> when the app's look is entirely its own (a game board, a full-bleed poster). The variables stay; fields, fonts and the no-sideways-overflow rule are then yours to set.
- It keeps the page from scrolling sideways (overflow-x: clip): anything wider than the window is cut off, not reachable, so check_app still reports it.

## Focus and structure

Design around the person's job, with one focus per screen. Name the job in one sentence before designing ("start today's workout and log it set by set"); the first screen does that job and nothing competes with it. Everything else lives one step away.

- A training app opens on today's workout. Plan editing and progress are their own screens, not sections stacked under it. A budget opens on "how much is left this month" and the add button; categories and history are a tap away. A reading log opens on what you're reading now.
- One primary action per screen, big and obvious (Start, Add, Study now); everything else is quieter. Summary before detail: the number that matters at the top, the list after, history on its own tab.
- Real app structure is welcome. Tabs: 2 to 4 sections named by what the person does or looks at (Today, Plan, Progress), a bottom tab bar on iPhone and a sidebar from 900 px. Push a screen for one thing (one workout, one person) with a back button that names where it goes. A doing mode (a workout, a review, cooking) hides the tabs and shows one step at a time. Sheets for short tasks that return to where you were (add, edit, pick), never for whole sections. Segmented controls switch views.
- The screens are routes (amber-router) inside amber-ui's Shell: <Route path="/" component={Today} default />, <Route path="/plan/:day" component={PlanDay} />. A pushed screen has a back button that names where it goes (back()). Keep a doing mode (a workout in progress) in useAppData so the app reopens where the person was.
- On the first screen: one primary action, one or two key numbers, then a short list or view. If you're stacking more than four independent sections (a summary, a chart, a form, a history, settings…) on one screen, split them into screens. check_app warns when a screen holds too many.
- Navigation controls are real buttons or links with labels (Shell's tab bar sets aria-current), at least 44 pt, and the active place is obvious.

## Sheets and popups

- One sheet at a time: a fixed header (title, close) and a body that scrolls on its own; the page behind doesn't scroll.
- The sheet's main action is pinned to its bottom and never scrolls away.
- On iPhone a sheet rises from the bottom; the keyboard resizes the app's web view, so a bottom-pinned sheet or bar already sits above it (no visualViewport code needed); scroll a focused field into view. From 700 px a sheet is a centred panel no taller than the window.
- Escape and the scrim close it; focus moves into it and comes back to what opened it.
- Nothing floats over what the person is working on: toasts and timers get their own space, not over a field or the last row.
- Motion explains a change (a pushed screen slides, a sheet rises, a tick pops) and respects prefers-reduced-motion.

## Sizes

You own the layout at every size; the app must work and look intended across the whole range, with no sideways scrolling.

- The app's web view is its real size, with viewport-fit=cover, so env(safe-area-inset-*) works; resizing and the keyboard behave the standard web way.
- iPhone: 320-440 pt wide, portrait and landscape (up to about 930 pt wide in landscape, short height), safe areas at the edges, and the keyboard covering the bottom half while someone types.
- Mac: a note window from about 500 to 1,400+ px wide, resized live. Use the room on wide windows: a 400 px column floating in a 1,280 px window is a phone layout stretched, not a design.
- Embedded in another note (a sub-note shown inside its parent): a short strip, often 300-700 px wide; <html data-amber-context="widget"> (and the class amber-widget) and amber.context = { embedded, width, height } tell you. Keep a compact form that still makes sense there (the title, the one number or control that matters).
- Text sizes in rem: on iPhone the root follows the reader's text size, so the layout must hold at larger text too.
- Touch targets at least 44 pt on iPhone. Hover only as an extra on Mac, never the only way. Keyboard shortcuts are welcome on Mac (and for games).
- Nothing is ever wider than the window. Flex and grid children that hold text get min-width: 0, and long words wrap. Rows with several controls wrap onto a second line on the phone instead of shrinking or clipping; give values their unit ("5 reps") rather than separate labels.
- Decorations stay inside their box. overflow: hidden is only for things meant to be cut (images, ellipsis text), never to hide a layout that doesn't fit.
- Fixed bars respect the safe area (env(safe-area-inset-bottom) or --amber-safe-bottom). The host's own controls sit outside the app, so no extra space is needed for them.
- Use what fits: CSS grid and flex with wrapping, container queries (container-type: inline-size; @container (min-width: …)), clamp() for type, and media queries. The app also sets the classes amber-narrow / amber-medium / amber-wide on <html> (under 600, to 900, from 900 px) as a convenience; don't rely on them.
- check_app renders at 375, 768 and 1,280 px (and the widget strip for sub-notes) and reports overflow, clipped text, small targets on the phone and an empty wide window. Look at every screen and every sheet in light and dark at 320, 390 and 1,440 px before calling it done; check_app sees only the first screen.

## Libraries

- In a project, import what you need by name: preact, preact/hooks, htm, amber-router, amber-ui, and chart.js (Chart), d3, three (THREE), tone (Tone), dayjs, marked, dompurify (DOMPurify), animejs (anime), canvas-confetti (confetti), topojson-client (topojson) and world-atlas (country shapes). Each of the last is the library's global as the default export: import Chart from "chart.js"; new Chart(canvas, config). They're on the device: nothing loads from the network.
- Any other npm package: call resolve_package { name, version?, file? } and add the entry it returns to <meta name="amber-libs" content="npm:qrcode-generator@1.4.4/qrcode.js#sha384-…"> in /index.html; Amber Notes downloads that exact file once, checks the hash and keeps it, and it loads before your modules as a global (window.qrcode). Pick a UMD or global build. Prefer a bundled library when one does the job.
- Never paste a library's code into a file: it bloats the app and can't be checked or updated. check_app flags pasted copies.

## Games, toys and fun

Fun is welcome: a game from a vocabulary note, a habit tracker that feels like a game, a drum machine whose pattern lives in the note, a 3D toy. Game basics:

- An animation loop with requestAnimationFrame, time-based (use the frame's timestamp, not a fixed step per frame), drawn on a canvas sized to its container times devicePixelRatio.
- Controls for touch and keyboard: pointer events (pointerdown/move/up) for taps and drags, keys for Mac. Big touch areas; no hover.
- Pause when hidden (document.visibilityState, a Pause button) and when the person switches to Text.
- Keep high scores, progress and game state in the app's own data (useAppData), so it survives closing the app; content to play with comes from the note.
- Sound only after a tap (audio can't start on its own); a mute button; keep it short and quiet.
- Make it start right away, show how to play in one line, and give a way to restart.

## Never

- No direct network: no fetch() or XHR to the internet, no external URLs (not even in comments), no @import, no web fonts. The app is refused if it has them; it couldn't load them anyway. Live data (prices, weather) only through fetch from "amber" to hosts declared in amber-needs, which the person approves once (see API keys). fetch("/src/words.json") reads the app's own files.
- No localStorage/sessionStorage/IndexedDB/cookies: the sandbox doesn't keep them. Use useAppData.
- No alert/confirm/prompt dialogs: use a Sheet or Dialog from amber-ui, or an inline message.
- No window.amber, op objects or table positions in a project: the hooks from "amber" do that, by name.
- Don't copy the note's rows into the app's files or its data to edit them there: change the note through the hooks or the data tools.

## A complete example

Training (get_page_guide with example: "training" returns every file): strength training over the note's Plan and Log tables. Today is the first screen and does one job (log today's sets); Plan and Progress are their own screens in the Shell; logging is a Sheet; units and the weekly goal are in Settings with useSettings. Its Today screen:

```jsx
import { useState } from "preact/hooks";
import { useNote, useTable, useSettings } from "amber";
import { List, ListRow, Sheet, Input, Button, EmptyState } from "amber-ui";
import ScreenHeader from "../components/ScreenHeader.jsx";
import { DAYS, DEFAULTS, weight, exercisesOf, lastSet } from "../data.js";

export default function Today() {
  const { today } = useNote();
  const plan = useTable("Plan"), log = useTable("Log");
  const [{ unit }] = useSettings(DEFAULTS);
  const [logging, setLogging] = useState(null), [kg, setKg] = useState("");

  const dayName = DAYS[new Date(today + "T12:00").getDay()];
  const day = plan.rows.find((r) => r.Day === dayName) || plan.rows[0];
  if (!day) return <EmptyState title="No plan yet" body="Add a Plan table with Day, Workout and Exercises." />;
  const done = (name) => log.rows.some((r) => r.Date === today && r.Exercise === name);

  const open = (name) => { setKg(lastSet(log, name)?.Weight ?? ""); setLogging(name); };
  const save = async () => {
    const last = lastSet(log, logging);
    await log.add({ Date: today, Exercise: logging, Sets: last?.Sets ?? "3", Reps: last?.Reps ?? "8", Weight: kg });
    setLogging(null);
  };

  return (
    <div class="screen">
      <ScreenHeader title="Today" subtitle={`${day.Workout} · ${day.Day === dayName ? "today" : day.Day}`} />
      <List>
        {exercisesOf(day).map((name) => {
          const last = lastSet(log, name);
          return (
            <ListRow title={name} subtitle={last ? `Last: ${last.Sets} × ${last.Reps} at ${weight(+last.Weight, unit)}` : "First time"}
              trailing={done(name) ? <span class="logged">Logged</span> : null}
              onClick={done(name) ? undefined : () => open(name)} />
          );
        })}
      </List>
      <Sheet open={!!logging} onClose={() => setLogging(null)} title={logging || ""}
        actions={<><Button variant="secondary" onClick={() => setLogging(null)}>Cancel</Button><Button onClick={save} disabled={!kg}>Log Set</Button></>}>
        <Input label="Weight (kg)" inputmode="decimal" value={kg} onInput={(e) => setKg(e.currentTarget.value)} hint="The same sets and reps as last time." />
      </Sheet>
    </div>
  );
}
```

## Copying a kit component

The amber-ui components are small Preact files. To change one beyond CSS, get its source (get_page_guide with kit: "Sheet"), write it to /src/components/Sheet.jsx, and import yours instead. The kit's components: TabBar, EmptyState, Stat, Toast, Toggle, Button, Icon, Slider, Card, Tabs, Fields, List, Sheet.
