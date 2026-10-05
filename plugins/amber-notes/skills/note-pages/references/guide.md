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
Each change lands in the note's markdown as a normal edit the person can see and undo.
The page's own data (not the note's text; for state the person wouldn't type, like settings, logs, a schedule): amber.data = { values, collections };
  amber.store.get(key) / amber.store.set(key, value); amber.store.collection(name).list() / query(fn) / get(id) / add(fields) -> { id } / update(id, patch) / remove(id); amber.setData(mergePatch).
  amber.onChange(fn) passes (note, data). Up to 4 MB. Files: amber.files.save({ name, type, base64 }) -> { file: { $file, ... } }, amber.files.read(ref) -> { dataURL }; keep the ref in a record.
The device, through the system's own prompts (results go to the page only; write to the note explicitly if wanted): amber.device.reminders.create({ title, due, repeat: "daily" }), calendar.today() -> { events: [{ title, start, end, location, attendees }] },
  notify({ title, body, at | in }), openURL(url), photos.pick({ limit }) / camera.take() -> { files: [{ $file, thumb }] }, contacts.pick() -> { contact }, files.pick(), location.once() -> { lat, lon, place },
  maps.open({ lat, lon | query, directions }), maps.snapshot({ lat, lon, km, width, height, dark }) -> { dataURL }. On-device AI: amber.ai.available(), amber.ai.respond(prompt, { instructions }) -> { text }. Every call returns { ok, ... } or { ok: false, error }.
Settings the person can change without an AI: declare <meta name="amber-settings" content='{"settings": [{ "key": "budget", "label": "Monthly budget", "type": "number", "default": 15000 }]}'> (types: text, number, choice with "options", list, color, currency).
  Amber Notes shows them in App Settings; read amber.settings (defaults filled in); onChange runs when they change. Use settings for names, goals, limits, currencies and categories instead of hardcoding them.
Network: the page itself can't reach anything. Declare hosts in <meta name="amber-needs" content='{"hosts": ["api.open-meteo.com"], "keys": [{ "name": "OpenWeather", "hosts": ["api.openweathermap.org"], "query": "appid={key}", "help": "How to get one" }]}'>
  and call amber.fetch(url, { method, headers, body, key }) -> { ok, status, body }. The person approves each host once and sees every request; with key, the app adds that API key (the page never sees it).
Look like Amber Notes: the app sets these CSS variables on :root, already switched for light and dark, and gives body its font, text colour and background. Use them instead of your own colours and fonts:
  --amber-bg (the note's background), --amber-surface (cards and grouped rows), --amber-fill (controls, empty cells), --amber-text, --amber-text-secondary, --amber-separator,
  --amber-accent (amber, for marks and filled controls), --amber-accent-text (amber for text), --amber-accent-soft (a soft amber fill), --amber-on-accent (text on --amber-accent),
  --amber-danger, --amber-radius (cards), --amber-radius-small (controls), --amber-font (the system font), --amber-font-rounded, --amber-font-mono, --amber-content-max, --amber-gutter.
Fit every width: the page fills the note, from 320 px on a small iPhone to 1,800 px in a full-screen Mac window, and re-lays out live as the window resizes. Put content in a container with max-width: var(--amber-content-max) (1100 px), margin: 0 auto and side padding var(--amber-gutter). Use one column under 600 px, and from 900 px use the room (side-by-side sections, more history, bigger numbers) with @media (min-width: 900px) or the classes amber-narrow / amber-medium / amber-wide the app keeps on <html>. Never a fixed width, never a stretched phone layout. Don't set a background on html or body.
One self-contained HTML document, at most 256 KB; the app's own data at most 4 MB.

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

- Find tables and columns by name, case-insensitively, not by position: `const t = note.tables.find(t => t.columns.some(c => /^date$/i.test(c.name)))`. Fall back gracefully when a column is missing (show an empty state that says which column to add), never throw.
- Cells are strings. Parse numbers leniently: `parseFloat(s.replace(/\s/g, "").replace(",", "."))`, treat NaN as empty. Treat ✓, x, yes, done, 1, true as done.
- Dates are "yyyy-mm-dd" strings; compare them as strings. Use amber.note.today, not the clock, for "today".
- Empty table or note: render a friendly empty state with what to add, not a blank page.
- Apps must handle 0 rows and 500 rows. Build HTML strings once per render, not per cell with appendChild in a loop.
- Escape every value from the note before putting it in HTML: `const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c])`. Notes contain <, &, quotes.
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

## Design: Amber's theme is the base, not a cage

Every app should look like it was made for what it does. A tracker, a game, a calculator, a planner and a music toy want different layouts; don't default to a card with a list.

- Keep the base: text, background and accent from the --amber-* variables (listed in the contract above), so the app sits in Amber Notes and follows dark mode. Don't set a background on html or body. Surfaces, radius and fonts are defaults you may leave: a game board, a big dial, a full-bleed chart, a calendar wall or a keypad can have their own shapes, sizes and extra colors (give extra colors a dark variant in @media (prefers-color-scheme: dark)).
- Pick the form from the job. A habit tracker can be a wall of days, a garden that grows, or a ring per habit. A budget can be a dial or a stacked bar over the month. A calculator is a keypad with a big display. A vocabulary note can be a game. Use type scale, space, grids, canvas and SVG, with motion where it explains something.
- Still: one clear focus first, then details. Readable text (at least 12 px, contrast 4.5:1), tabular-nums for numbers, no emoji as icons (inline SVG), no motion that loops for nothing; respect prefers-reduced-motion.
- Accessibility: real <button>s and <input>s; every input has a <label> (or aria-label); icon-only buttons have aria-label; state that is shown by color is also shown another way; canvas and SVG views get role="img" and an aria-label, or a text equivalent; lang on <html>.
- Keep it small: most good apps are 6-30 KB of HTML (libraries don't count; see Libraries).

## Sizes

You own the layout at every size; the app must work and look intended across the whole range, with no sideways scrolling.

- iPhone: 320-440 pt wide, portrait and landscape (up to about 930 pt wide in landscape, short height), safe areas at the edges, and the keyboard covering the bottom half while someone types.
- Mac: a note window from about 500 to 1,400+ px wide, resized live. Use the room on wide windows: a 400 px column floating in a 1,280 px window is a phone layout stretched, not a design.
- Embedded in another note (a sub-note shown inside its parent): a narrow strip, often 300-700 px wide and short. Keep a compact form that still makes sense.
- Touch targets at least 44 pt on iPhone. Hover only as an extra on Mac, never the only way. Keyboard shortcuts are welcome on Mac (and for games).
- Use what fits: CSS grid and flex with wrapping, container queries (container-type: inline-size; @container (min-width: …)), clamp() for type, and media queries. The app also sets the classes amber-narrow / amber-medium / amber-wide on <html> (under 600, to 900, from 900 px) as a convenience; don't rely on them.
- check_app renders at 375, 768 and 1,280 px and reports overflow, clipped text, small targets on the phone and an empty wide window.

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

```html
<!doctype html>
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
    if (!t) { app.innerHTML = `<h1>${esc(note.title)}</h1><div class="card empty">Add a table with an Item column to the note to see it here.</div>`; return; }
    const item = col(t, /^(item|name|title)$/i);
    app.innerHTML = `
      <h1>${esc(note.title)}</h1>
      <div class="card">${t.rows.length ? t.rows.map((r) => `<div class="row"><div class="grow">${esc(r[item])}</div></div>`).join("") : '<div class="empty">Nothing yet.</div>'}</div>
      <div class="card">
        <form id="add"><label>New item<input name="v" required></label><button>Add</button></form>
        <div class="err" role="alert">${esc(error)}</div>
      </div>`;
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
```

## Templates

Tested, complete pages to start from (get_page_guide with template: "<name>" returns one). Adapt column names to the note's, never the note to the template, unless the note has no table yet.
- budget: Spending this month against a monthly budget, by category, with a month picker and a quick add form. Budget, currency and categories are App Settings. Expects: A table with Date (yyyy-mm-dd), an amount column (Amount, Cost, Price, Kr or Sum) and optionally Item and Category columns.
- crm: A sales pipeline: open value per stage, deals grouped by stage with a stage picker on each, search, and a form to add a contact. Currency and stages are App Settings. Expects: A table with a name column (Company, Name or Contact), a Stage (or Status) column, optionally Value, Email and Contact columns.
- flashcards: Flip cards one at a time, mark each Known or Again; cards you don't know yet come first, and what you know is remembered in the app's data. Which side shows first is an App Setting. Expects: A table whose first two columns are the front and the back (e.g. Spanish | English, Question | Answer). Keeps amber.data.values.known, front text to the date it was known.
- habit-tracker: Tick today's habits, see streaks, a 14-day grid and progress toward a weekly goal. The goal and which habits to show are App Settings. Expects: A table with a Date column (yyyy-mm-dd) and one column per habit; a done day is ✓ (x, yes and 1 also count).
- reading-log: Books as cards with ratings, books per month against a yearly goal (an App Setting), the average rating, a want-to-read checklist and a form to log a finished book. Expects: A table with Title and Author, optionally Finished (yyyy-mm-dd) and Rating (1-5) columns; checklist items are shown as want-to-read.
- trip-log: A trip at a glance: a countdown, the key facts, the day-by-day plan, and every checklist in the note (to do, ideas, packing) with tick boxes and progress. The start date is an App Setting. Expects: Optionally a table with Date (yyyy-mm-dd) and What/Plan columns (plus Time, Where); checklists under headings; key facts as Label: value lines.
- workout-log: Weekly distance and time for the last eight weeks, this week's totals against a weekly goal (an App Setting), the latest sessions and a log form. Expects: A table with Date (yyyy-mm-dd), optionally Type (Run, Bike...), a distance column (Km, Distance) and a time column (Minutes, Time).
