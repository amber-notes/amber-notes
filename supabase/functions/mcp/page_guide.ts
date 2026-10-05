// Note pages (prototype): what an AI is taught about building them (people call them the note's app). One source for the server's
// instructions, the tool descriptions, get_page_guide, the MCP prompts and resources, and the
// Claude skill (plugins/amber-notes/skills/note-pages, written from here by
// scripts/page-evals/build-skill.ts), so none of them drift.

import { MAX_PAGE_BYTES, MAX_PAGE_DATA_BYTES, PAGE_CONTRACT } from "./page.ts";
import { AMBER_BASE_CSS, AMBER_TOKENS } from "./amber-base.ts";
import { AMBER_UI } from "./amber-ui.ts";
import { APP_EXAMPLES } from "./app_examples.gen.ts";
import { scaffold } from "./app_scaffold.ts";

const SCAFFOLD = scaffold("Example");
/** What "amber-ui" exports (its index.jsx). */
export const AMBER_UI_EXPORTS = [...AMBER_UI.src["index.jsx"].matchAll(/export \{([^}]+)\}/g)].flatMap((m) => m[1].split(",").map((x) => x.trim()))
  .filter((x) => x && !/^use/.test(x)).join(", ");
const LIBS_BY_PACKAGE = "chart.js (Chart), d3, three (THREE), tone (Tone), dayjs, marked, dompurify (DOMPurify), animejs (anime), canvas-confetti (confetti), topojson-client (topojson) and world-atlas (country shapes)";
const EXAMPLE_TODAY = APP_EXAMPLES.training.files["/src/screens/Today.jsx"].trim();

/** The few lines every client sees in the server's instructions. Clients differ in what else they
 *  read (resources, prompts, skills), so this and the tool descriptions carry the essentials. */
export const PAGE_INSTRUCTIONS = `Apps: a note can have an app side, a small app (a habit tracker, a budget, a training log) next to its Text side. With the person always call it "the note's app" and the "App" side, never "page" (some tools still say page).
- Before making, redesigning or fixing an app, call get_page_guide once, then read_note; for an existing app, list_app_files and its README.md.
- An app is a normal small Preact project: create_app makes it (index.html, src/main.jsx, src/App.jsx with a tab bar on iPhone and a sidebar from 900 px, src/screens/, src/components/, src/styles.css, README.md); read_app_file, write_app_file and edit_app_file change it like any codebase. Every write compiles JSX and answers with what to fix.
- Use the hooks: import { useNote, useTable, useChecklist, useAppData, useSettings, batch } from "amber"; tables and checklists by the heading above them (useTable("Log")), never by position, never window.amber. Components from "amber-ui" (Shell, List, ListRow, Sheet, Input, Button, Stat, Icon…), screens with "amber-router", libraries by npm name (import Chart from "chart.js").
- Every app starts with amber-base.css, the default look (get_page_guide shows the real file): it sits in a cascade layer, so any style you write wins over it without !important. Keep every input visible as a field in both themes.
- Design around the person's job with one focus per screen; other screens, pushed screens and sheets for the rest (a training app opens on today's workout; plan and progress are other screens). Settings live inside the app (useSettings, a Settings screen).
- Give each app its own look for its job, not a beige card with a list; keep text readable (4.5:1) in light and dark. Games and toys are welcome. It must work on an iPhone (320-440 pt) and in a Mac window (500-1400+ px), using the room when it's wide.
- When it's done, run check_app (and preview_app if you can see images) and fix what they report before telling the person.
- Data never needs the app rewritten: the note's tables and checklists change with add_table_rows, update_table_rows, delete_table_rows, edit_table_columns, add_checklist_items, update_checklist_items; the app's own data with get_page_data / update_page_data.
- API keys: apps declare the keys they need; list_api_keys shows which exist (never values). Walk the person through getting a key and adding it in Amber Notes › Settings › API Keys. Never ask for a key in the chat; if one is pasted, don't store or repeat it: tell them to add it in Settings.`;

const kb = (n: number) => (n >= 1048576 ? `${n / 1048576} MB` : `${n / 1024} KB`);

/** The contract the app keeps (page.ts, owned with the app's bridge), quoted in set_note_page and get_note_page. */
export const PAGE_API = `${PAGE_CONTRACT.replace("its full text is AMBER_BASE_CSS", "get_page_guide shows its full text")}
One self-contained HTML document, at most ${kb(MAX_PAGE_BYTES)}; the app's own data at most ${kb(MAX_PAGE_DATA_BYTES)}.`;

/** The guide get_page_guide returns, the MCP resource, and the skill's reference. Markdown. */
export const PAGE_GUIDE = `# Building apps in Amber Notes notes

A note can have an app: one HTML document shown on the note's App side, next to its Text side. A habit grid, a budget with totals, flashcards, a trip planner. In the tools it's called the note's page (set_note_page, get_note_page); when you talk to the person, call it "the note's app" or "the App side", and never "page" or "Pages".

The note's text stays the person's own data: they can always flip to Text and see and edit every row. The app reads it, changes it through checked edits, and keeps its own data (settings, logs, records, files) in a store next to it, never in the text. Replacing or removing an app never loses data: the last 10 versions are kept.

## The contract

${PAGE_API}

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

\`\`\`
${Object.keys(SCAFFOLD).sort().join("\n")}
\`\`\`

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
- "amber-ui": ${AMBER_UI_EXPORTS}. Shell gives an app with several screens its frame: a tab bar on iPhone, a sidebar from 900 px. Every component is in the amber-ui layer, so your CSS wins; to change one deeply, copy its source (get_page_guide with kit: "Sheet") into /src/components/ and import yours.
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
- Cells are strings. Parse numbers leniently: \`parseFloat(s.replace(/\\s/g, "").replace(",", "."))\`, treat NaN as empty. Treat ✓, x, yes, done, 1, true as done.
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

Every app gets two stylesheets before its own. amber-tokens.css defines the variables (${AMBER_TOKENS.join(", ")}), already switched for light and dark and for iPhone or Mac. amber-base.css is the default look, and this is the whole file, exactly as the app ships it:

\`\`\`css
${AMBER_BASE_CSS.trim()}
\`\`\`

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

- In a project, import what you need by name: preact, preact/hooks, htm, amber-router, amber-ui, and ${LIBS_BY_PACKAGE}. Each of the last is the library's global as the default export: import Chart from "chart.js"; new Chart(canvas, config). They're on the device: nothing loads from the network.
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

\`\`\`jsx
${EXAMPLE_TODAY}
\`\`\`

## Copying a kit component

The amber-ui components are small Preact files. To change one beyond CSS, get its source (get_page_guide with kit: "Sheet"), write it to /src/components/Sheet.jsx, and import yours instead. The kit's components: ${Object.keys(AMBER_UI.src).filter((f) => f.endsWith(".jsx") && f !== "index.jsx").map((f) => f.replace(".jsx", "")).join(", ")}.
`;

/** MCP prompts: starting points a client can offer the person. */
export const PAGE_PROMPTS = [
  {
    name: "make_app",
    title: "Make this note an app",
    description: "Give a note an app: a tracker, a budget, flashcards, a planner, over the note's data.",
    arguments: [{ name: "note", description: "The note's title or id.", required: true }, { name: "idea", description: "What the app should do, if you have something in mind.", required: false }],
    text: (a: Record<string, string>) => `Make my note "${a.note}" an app${a.idea ? `: ${a.idea}` : ""}. Call get_page_guide first, then read the note, shape its data into tables under headings if needed (keeping every fact), start the project with create_app, build its screens and components, and run check_app. Tell me what it does in a line or two.`,
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
    text: (a: Record<string, string>) => `Change the app of my note "${a.note}": ${a.change}. Call get_page_guide, read the note, then the app's README.md and the files you need (list_app_files, read_app_file). Keep the note's data and columns exactly as they are; change files with edit_app_file (write_app_file for new ones), keep README.md current, then run check_app.`,
  },
] as const;

export const GUIDE_URI = "amber://guides/note-pages";
export const BASE_CSS_URI = "amber://styles/amber-base.css";
export const templateUri = (name: string) => `amber://page-templates/${name}`;
