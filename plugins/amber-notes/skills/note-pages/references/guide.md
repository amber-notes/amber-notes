<!-- Generated from supabase/functions/mcp/page_guide.ts by scripts/page-evals/build-skill.ts. Don't edit. -->
# Apps in Amber Notes

A note can be an app: a habit tracker, a budget, a workout log, a game. The person opens the note and the app is all they see. This says where an app lives and what it can use. How it looks and works is your call; build it as well as you would anywhere.

## Where it runs

- Inside a note in Amber Notes, on iPhone (320-440 pt wide, safe areas at the edges, the keyboard shrinks the view) and on the Mac (a window from about 500 to 1,800 px, resized live). Both matter: a phone layout and a real wide layout.
- Light and dark mode follow the device (prefers-color-scheme).
- In a sandbox with no network (see Network).
- Nothing around the app shows the note's title, so the app shows it if it wants a title.

## The project

A normal Vite + React 19 + TypeScript + Tailwind CSS 4 + shadcn/ui project. create_app writes it:

```
/README.md
/index.html
/package.json
/src/App.tsx
/src/components/ui/button.tsx
/src/components/ui/card.tsx
/src/components/ui/input.tsx
/src/components/ui/label.tsx
/src/index.css
/src/lib/amber.ts
/src/lib/utils.ts
/src/main.tsx
/tsconfig.json
```

- Work on it like any codebase: list_app_files, read_app_file, write_app_file, edit_app_file, move_app_file, delete_app_file. Keep README.md current; the next AI reads it first.
- Every save compiles the project the way Vite would (TSX/JSX/TS, the @/ alias, imports without extensions, Tailwind from the classes you use) and answers with errors (the app is broken: compile errors, imports to nothing, script errors, content wider than the screen, unreadable text) and notes (information; use your judgment). Nothing is installed: package.json is there for orientation.
- React runs on preact/compat. Import by name: react, react-dom, react-dom/client, lucide-react (icons), clsx, tailwind-merge, class-variance-authority, the @radix-ui packages shadcn uses, and chart.js, d3, three, tone, dayjs, marked, dompurify, animejs, canvas-confetti, topojson-client and world-atlas (each library's global as its default export: import Chart from "chart.js"). src/components/ui/ has shadcn components; they're the app's own files, so add and change them freely.
- Any other npm package: resolve_package pins an exact file with a hash; add it to <meta name="amber-libs" content="npm:…"> in index.html and it loads before your code as a global.
- Styling: Tailwind, with shadcn's variables (--background, --primary, …) set from Amber's colours in src/index.css; change them to give the app its own look. Two stylesheets load first, in cascade layers your CSS always beats: amber-tokens.css (the --amber-* variables: --amber-bg, --amber-surface, --amber-fill, --amber-text, --amber-text-secondary, --amber-separator, --amber-field, --amber-field-border, --amber-accent, --amber-accent-text, --amber-accent-soft, --amber-on-accent, --amber-danger, --amber-radius, --amber-radius-small, --amber-content-max, --amber-gutter, --amber-root-font, --amber-font, --amber-font-rounded, --amber-font-mono, --amber-safe-top, --amber-safe-right, --amber-safe-bottom, --amber-safe-left, --amber-inset-bottom, --amber-keyboard) and amber-base.css:

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

## Data

The app's data is JSON that Amber Notes keeps for it: encrypted, synced across the person's devices, versioned, with Undo for changes the person makes. Up to 4 MB; photos and recordings as files.

- From "@/lib/amber" (which re-exports "amber"): const [value, setValue] = useStore("key", initial); const workouts = useCollection("workouts") → { items, add(fields) → id, update(id, patch), remove(id) }; const [settings, update] = useSettings({ unit: "kg" }); batch(async () => { … }) for several changes as one Undo; setSummary("3 of 4 habits today") for the line under the note's title in the list.
- localStorage works and is kept the same way (synced), so code written for the web just works. sessionStorage lasts while the app is open; there's no IndexedDB.
- Settings the person can change live inside the app, in the app's own design.
- When a note that already had text becomes an app, useImported() gives what it held ({ tables: { Heading: [rows] }, checklists, text }): start the app's data from it once.
- You read and change the data from here: get_page_data (all of it, a collection, or a path), query_app_data (filter, group by a field or by day/week/month, sum/avg/min/max: "how was my week?"), update_page_data (merge values, add/update/remove records, import CSV, attach files). The app updates at once; you never rewrite the app to change its data.

## Network and API keys

The app can't reach the internet by itself. For live data, declare the hosts in index.html and the person allows them once:

`<meta name="amber-needs" content='{"hosts": ["api.open-meteo.com"], "keys": [{ "name": "OpenWeather", "hosts": ["api.openweathermap.org"], "query": "appid={key}", "help": "Where to get one" }]}'>`

Then call fetch(url, { key: "OpenWeather" }) from "@/lib/amber"; it returns { ok, status, body }. Keys live in Amber Notes › Settings › API Keys; the app and you never see their values. list_api_keys shows which exist. Walk the person through getting one (the site, the free plan, where the key is) and adding it there. Never ask for a key in the chat; if one is pasted, don't store or repeat it, and suggest they make a new one. Prefer services that need no key (api.open-meteo.com for weather). fetch("/src/data.json") reads the app's own files.

The device, through the system's own prompts: device.reminders, calendar, notify, photos, camera, contacts, location, maps, weather; on-device AI with ai.respond. Each returns { ok, … }.

## Seeing your work

- Every save tells you what broke. Pass look: true to get a screenshot.
- preview_app: screenshots at iPhone and Mac sizes, light and dark, over a sample with your data's shape.
- check_app: the full check at 320, 390 and 1280 px, light and dark, with no data, a new record and 400 records. errors mean broken; notes are information.
- Look at it before you tell the person it's done, then say in a line or two what the app does.
