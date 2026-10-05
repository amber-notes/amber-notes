// Note pages (prototype): what an AI is taught about building them (people call them the note's app). One source for the server's
// instructions, the tool descriptions, get_page_guide, the MCP prompts and resources, and the
// Claude skill (plugins/amber-notes/skills/note-pages, written from here by
// scripts/page-evals/build-skill.ts), so none of them drift.

import { MAX_PAGE_BYTES, MAX_PAGE_DATA_BYTES, PAGE_CONTRACT } from "./page.ts";
import { AMBER_BASE_CSS, AMBER_TOKENS } from "./amber-base.ts";
import { scaffold } from "./app_scaffold.ts";

const SCAFFOLD = scaffold("Example");
const LIBS_BY_PACKAGE = "chart.js, d3, three, tone, dayjs, marked, dompurify, animejs, canvas-confetti, topojson-client and world-atlas";

/** The few lines every client sees in the server's instructions. Clients differ in what else they
 *  read (resources, prompts, skills), so this and the tool descriptions carry the essentials. */
export const PAGE_INSTRUCTIONS = `Apps: a note in Amber Notes can be an app. Call it "the note's app" with the person, never "page" (some tools still say page).
- Before making or changing an app, call get_page_guide once. It says where an app lives; how it looks and works is up to you.
- An app is a normal Vite + React + TypeScript + Tailwind + shadcn/ui project. create_app starts one; list_app_files, read_app_file, write_app_file and edit_app_file work on it like any codebase. Every save compiles it and tells you what broke.
- Its data is JSON the app keeps (useStore, useCollection, useSettings from "@/lib/amber", or localStorage: all synced and encrypted). You read and change it with get_page_data, query_app_data and update_page_data.
- It runs inside a note on iPhone and Mac, light and dark, with no network except hosts the person allows.
- See your work with preview_app and check_app before you say it's done.`;

const kb = (n: number) => (n >= 1048576 ? `${n / 1048576} MB` : `${n / 1024} KB`);

/** The contract the app keeps (page.ts, owned with the app's bridge), quoted in set_note_page and get_note_page. */
export const PAGE_API = `${PAGE_CONTRACT.replace("its full text is AMBER_BASE_CSS", "get_page_guide shows its full text")}
One self-contained HTML document, at most ${kb(MAX_PAGE_BYTES)}; the app's own data at most ${kb(MAX_PAGE_DATA_BYTES)}.`;

/** The guide get_page_guide returns, the MCP resource, and the skill's reference. Markdown. Short on
 *  purpose (Emil, 2026-10-06): where an app lives and what it can use, not how to design it. */
export const PAGE_GUIDE = `# Apps in Amber Notes

A note can be an app: a habit tracker, a budget, a workout log, a game. The person opens the note and the app is all they see. This says where an app lives and what it can use. How it looks and works is your call; build it as well as you would anywhere.

## Where it runs

- Inside a note in Amber Notes, on iPhone (320-440 pt wide, safe areas at the edges, the keyboard shrinks the view) and on the Mac (a window from about 500 to 1,800 px, resized live). Both matter: a phone layout and a real wide layout.
- Light and dark mode follow the device (prefers-color-scheme).
- In a sandbox with no network (see Network).
- Nothing around the app shows the note's title, so the app shows it if it wants a title.

## The project

A normal Vite + React 19 + TypeScript + Tailwind CSS 4 + shadcn/ui project. create_app writes it:

\`\`\`
${Object.keys(SCAFFOLD).sort().join("\n")}
\`\`\`

- Work on it like any codebase: list_app_files, read_app_file, write_app_file, edit_app_file, move_app_file, delete_app_file. Keep README.md current; the next AI reads it first.
- Every save compiles the project the way Vite would (TSX/JSX/TS, the @/ alias, imports without extensions, Tailwind from the classes you use) and answers with errors (the app is broken: compile errors, imports to nothing, script errors, content wider than the screen, unreadable text) and notes (information; use your judgment). Nothing is installed: package.json is there for orientation.
- React runs on preact/compat. Import by name: react, react-dom, react-dom/client, radix-ui (what shadcn v4 builds on), lucide-react (every icon), recharts, date-fns, zod, motion, sonner, react-day-picker, clsx, tailwind-merge, class-variance-authority, amber-router (screens: Router, Route, route(), back()), and ${LIBS_BY_PACKAGE} (each library's global as its default export: import Chart from "chart.js").
- src/components/ui/ has 20 shadcn/ui components and src/components/app-shell.tsx a frame with a tab bar on iPhone and a sidebar from 900 px; they're the app's own files, so add and change them freely.
- Any other npm package: resolve_package pins an exact file with a hash; add it to <meta name="amber-libs" content="npm:…"> in index.html and it loads before your code as a global.
- Styling: Tailwind, with shadcn's variables (--background, --primary, …) set from Amber's colours in src/index.css; change them to give the app its own look. Two stylesheets load first, in cascade layers your CSS always beats: amber-tokens.css (the --amber-* variables: ${AMBER_TOKENS.join(", ")}) and amber-base.css:

\`\`\`css
${AMBER_BASE_CSS.trim()}
\`\`\`

## Data

The app's data is JSON that Amber Notes keeps for it: encrypted, synced across the person's devices, versioned, with Undo for changes the person makes. Up to 4 MB; photos and recordings as files.

- From "@/lib/amber" (which re-exports "amber"): const [value, setValue] = useStore("key", initial); const workouts = useCollection("workouts") → { items, add(fields) → id, update(id, patch), remove(id) }; const [settings, update] = useSettings({ unit: "kg" }); batch(async () => { … }) for several changes as one Undo; setSummary("3 of 4 habits today") for the line under the note's title in the list.
- localStorage works and is kept the same way (synced), so code written for the web just works. sessionStorage lasts while the app is open; there's no IndexedDB.
- Settings the person can change live inside the app, in the app's own design.
- The person's AI reaches this data through the data tools, without opening the app ("remove the entries for 3 to 5 October"). Keep its shape simple and describe it in README.md under Data.
- When a note that already had text becomes an app, useImported() gives what it held ({ tables: { Heading: [rows] }, checklists, text }): start the app's data from it once.
- You read and change the data from here: get_page_data (all of it, a collection, or a path), query_app_data (filter, group by a field or by day/week/month, sum/avg/min/max: "how was my week?"), update_page_data (merge values, add/update/remove records, import CSV, attach files). The app updates at once; you never rewrite the app to change its data.

## Network and API keys

The app can't reach the internet by itself. For live data, declare the hosts in index.html and the person allows them once:

\`<meta name="amber-needs" content='{"hosts": ["api.open-meteo.com"], "keys": [{ "name": "OpenWeather", "hosts": ["api.openweathermap.org"], "query": "appid={key}", "help": "Where to get one" }]}'>\`

Then call fetch(url, { key: "OpenWeather" }) from "@/lib/amber"; it returns { ok, status, body }. Keys live in Amber Notes › Settings › API Keys; the app and you never see their values. list_api_keys shows which exist. Walk the person through getting one (the site, the free plan, where the key is) and adding it there. Never ask for a key in the chat; if one is pasted, don't store or repeat it, and suggest they make a new one. Prefer services that need no key (api.open-meteo.com for weather). fetch("/src/data.json") reads the app's own files.

The device, through the system's own prompts: device.reminders, calendar, notify, photos, camera, contacts, location, maps, weather; on-device AI with ai.respond. Each returns { ok, … }.

## Seeing your work

- Every save tells you what broke. Pass look: true to get a screenshot.
- You can try your app with try_app and write tests in tests/ (run_app_tests); do it for anything non-trivial.
- preview_app: screenshots at iPhone and Mac sizes, light and dark, over a sample with your data's shape.
- check_app: the full check at 320, 390 and 1280 px, light and dark, with no data, a new record and 400 records. errors mean broken; notes are information.
- Look at it before you tell the person it's done, then say in a line or two what the app does.
`;

/** MCP prompts: starting points a client can offer the person. */
export const PAGE_PROMPTS = [
  {
    name: "make_app",
    title: "Make this note an app",
    description: "Give a note an app: a tracker, a budget, flashcards, a planner, over the note's data.",
    arguments: [{ name: "note", description: "The note's title or id.", required: true }, { name: "idea", description: "What the app should do, if you have something in mind.", required: false }],
    text: (a: Record<string, string>) => `Make my note "${a.note}" an app${a.idea ? `: ${a.idea}` : ""}. Call get_page_guide first, then read the note, start the project with create_app and build it. Put any data the note already has into the app's data (update_page_data), keeping every fact. Look at it with preview_app and check_app, then tell me what it does in a line or two.`,
  },
  {
    name: "add_data",
    title: "Add data to a note",
    description: "Add rows or items to a note's table or checklist, from text, a list or pasted CSV.",
    arguments: [{ name: "note", description: "The note's title or id.", required: true }, { name: "data", description: "The rows or items, in any form (CSV, a list, prose).", required: true }],
    text: (a: Record<string, string>) => `Add this to my note "${a.note}". If it's an app, read its data first (get_page_data), use the same fields and value formats, and add it with update_page_data; otherwise add it to the note's tables or checklists. Don't change the app itself.\n\n${a.data}`,
  },
  {
    name: "change_app",
    title: "Change a note's app",
    description: "Change how a note's app looks or works, without touching its data.",
    arguments: [{ name: "note", description: "The note's title or id.", required: true }, { name: "change", description: "What to change.", required: true }],
    text: (a: Record<string, string>) => `Change the app of my note "${a.note}": ${a.change}. Call get_page_guide, then read the app's README.md and the files you need (list_app_files, read_app_file). Keep its data as it is; change files with edit_app_file (write_app_file for new ones), keep README.md current, and look at it with preview_app and check_app.`,
  },
] as const;

export const GUIDE_URI = "amber://guides/note-pages";
export const BASE_CSS_URI = "amber://styles/amber-base.css";
export const templateUri = (name: string) => `amber://page-templates/${name}`;
