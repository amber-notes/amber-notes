// Page evals: the tasks. Each seeds an account with notes (and sometimes a page or page data),
// gives the model one request as a person would type it, and checks what's there afterwards.
// Generic checks (the page renders, fits a phone, has dark mode, labels...) are in score.ts; the
// ones here are about this task's data and intent.
import { findTables } from "../../supabase/functions/mcp/notes.ts";
import { libraryReport } from "../../supabase/functions/mcp/libraries.ts";
import type { Render, Step } from "../page-render/render.ts";

export type Seed = {
  body: string; page?: string; data?: { values?: Record<string, unknown>; collections?: Record<string, Record<string, unknown>[]> };
  /** Its folder's path ("Work/Clients"), created as needed; none: no folder. */
  folder?: string; pinned?: boolean;
  /** Earlier texts, oldest first: the note is created with the first and saved as each, then as body (history). */
  earlier?: string[];
};
/** Every note in the account after the session, for checks across notes. */
export type NoteState = { id: string; title: string; body: string; folder: string; pinned: boolean; trashed: boolean; parent: string | null };
export type Final = {
  before: string; after: string; pageBefore: string | null; page: string | null; dataBefore: unknown; data: unknown;
  calls: { name: string; args: Record<string, unknown>; error: boolean }[]; answer: string; render?: Render;
  /** Ids of the seeded files, in order. */
  fileIds?: string[];
  others: { before: string; after: string }[];
  /** The whole account after the session (notes tasks). */
  notes?: NoteState[];
};
export type Check = { name: string; pass: boolean; detail?: string };
export type Task = {
  id: string; prompt: string; seed: Seed; others?: Seed[];
  /** The note must end with a page that renders. */
  page: boolean;
  /** Probe the page's first control. */
  interact?: boolean;
  /** The app should move: score that it animates after the first tap, with no errors. */
  plays?: boolean;
  /** The app should not be a card with a list: score canvas, drawn SVG or a real grid. */
  varied?: boolean;
  /** API keys the person has in Settings (names only). */
  apiKeys?: { name: string; hosts: string[]; set: boolean }[];
  /** Files already in their Amber Notes. */
  files?: { name: string; type: string; text: string }[];
  checks: (f: Final) => Check[];
  /** Hidden from the model (the try_app experiment): a person's walkthrough, probe by probe, each a
   *  list of try_app steps on a fresh copy of the final app and data; patterns like "/add|new/i". */
  walkthrough?: { name: string; steps: Step[]; desktop?: boolean }[];
  /** Features the brief asks for, looked for in the project's source. */
  features?: { name: string; re: RegExp }[];
};

const pad = (n: number) => String(n).padStart(2, "0");
const day = (offset: number) => { const d = new Date(Date.UTC(2026, 9, 5 + offset)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const rows = (md: string, i = 0) => findTables(md)[i]?.rows ?? [];
const cols = (md: string, i = 0) => findTables(md)[i]?.columns.map((c) => c.name) ?? [];
const check = (name: string, pass: boolean, detail?: string): Check => ({ name, pass, ...(detail && !pass ? { detail } : {}) });
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const hasFact = (md: string, ...parts: string[]) => md.split("\n").some((l) => parts.every((p) => norm(l).includes(norm(p))));
/** Every line of `before` that isn't a table row is still in `after`, in order. */
function proseKept(before: string, after: string): Check {
  const keep = before.split("\n").filter((l) => l.trim() && !l.trim().startsWith("|") && !l.includes("pane-table:"));
  const lines = after.split("\n");
  let at = 0;
  const missing = keep.filter((l) => { const k = lines.indexOf(l, at); if (k < 0) return true; at = k + 1; return false; });
  return check("prose_kept", missing.length === 0, missing.slice(0, 2).join(" / "));
}
/** Every original table row is still in the note: some row has the same value in each of its
 *  columns (matched by name, so added columns don't count against it). */
function rowsKept(before: string, after: string): Check {
  const now = findTables(after).flatMap((t) => t.rows.map((r) => new Map(t.columns.map((c, i) => [norm(c.name), norm(r[i] ?? "")]))));
  const lost = findTables(before).flatMap((t) => t.rows.filter((r) => !now.some((m) => t.columns.every((c, i) => m.get(norm(c.name)) === norm(r[i] ?? "")))).map((r) => r.join(" | ")));
  return check("rows_kept", lost.length === 0, lost.slice(0, 2).join(" / "));
}
const unchanged = (f: Final): Check => check("note_unchanged", f.before === f.after, "the note's markdown changed");
const pageUnchanged = (f: Final): Check => check("page_untouched", f.page === f.pageBefore, "the page was rewritten for a data change");
const pageChanged = (f: Final): Check => check("page_changed", !!f.page && f.page !== f.pageBefore, "the page wasn't changed");
function hue(hex: string): number {
  const [r, g, b] = [0, 2, 4].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 0.08) return -1;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const usedTool = (f: Final, ...names: string[]) => f.calls.some((c) => names.includes(c.name) && !c.error);

// MARK: Seeds

const HABITS_MESSY = `Habits

trying to do these every day: walk, read, stretch, no phone in bed

mon 28 sep - walked, read, stretched
tue 29 - read only, too tired
wed 30: walk + stretch + no phone!!
thu 1 oct walked read stretched no phone
fri 2 - nothing (party)
sat 3 walk, read
sun 4 read, stretch, no phone in bed
`;

const BUDGET_LIST = `October budget

Spent so far:
- Rent 9500 kr (housing) 1 Oct
- Groceries ICA 845 kr (food) 2 Oct
- SL card 970 kr (transport) 2 Oct
- Coffee w/ Lina 92 kr (food) 3 Oct
- Spotify 129 kr (subscriptions) 3 Oct
- Groceries Lidl 412,50 kr (food) 4 Oct
- Cinema 260 kr (fun) 4 Oct
- Netflix 149 kr (subscriptions) 5 Oct

Limit this month: 15 000 kr
`;

const READING = `Reading log

<!-- pane-table: Title=text; Author=text; Finished=date; Rating=scale 1-5 -->
| Title | Author | Finished | Rating |
| --- | --- | --- | --- |
| The Overstory | Richard Powers | 2026-06-14 | 5 |
| Piranesi | Susanna Clarke | 2026-07-02 | 4 |
| Tomorrow, and Tomorrow, and Tomorrow | Gabrielle Zevin | 2026-07-30 | 4 |
| Klara and the Sun | Kazuo Ishiguro | 2026-08-21 | 3 |
| The Dispossessed | Ursula K. Le Guin | 2026-09-12 | 5 |

Want to read: Middlemarch, The Remains of the Day.
`;

const EXPENSES = `Household expenses

| Date | Item | Category | Amt |
| --- | --- | --- | --- |
| 2026-09-02 | Electricity | Bills | 640 |
| 2026-09-05 | Groceries | Food | 1 210 |
| 2026-09-11 | Dentist | Health | 950 |
| 2026-09-19 | Groceries | Food | 880 |
| 2026-10-01 | Rent | Housing | 9 500 |
| 2026-10-03 | Groceries | Food | 735 |
`;

// The budget demo page from the prototype, as Claude first made it.
const BUDGET_PAGE = await Deno.readTextFile(new URL("../../demo/note-pages/budget.html", import.meta.url));

const WORKOUTS = `Workout log

<!-- pane-table: Date=date; Type=choice Run|Bike|Swim|Gym; Km=number; Minutes=number -->
| Date | Type | Km | Minutes |
| --- | --- | --- | --- |
| 2026-07-28 | Run | 5.1 | 29 |
| 2026-07-30 | Gym |  | 50 |
| 2026-07-31 | Bike | 22 | 61 |
`;

const WORKOUT_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
:root{--bg:#fbf8f3;--ink:#1d1a16;--muted:#7a7168;--card:#fff}@media (prefers-color-scheme:dark){:root{--bg:#1b1916;--ink:#f3eee8;--muted:#a39a90;--card:#26231f}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.4 -apple-system,system-ui,sans-serif;padding:20px 18px;max-width:680px;margin:0 auto}
.card{background:var(--card);border-radius:14px;padding:12px 16px;margin:8px 0}.muted{color:var(--muted);font-size:14px}.big{font-size:34px;font-weight:700}
</style></head><body><main id="app"></main><script>
const esc=(s)=>String(s??"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
amber.onChange((note)=>{const t=note.tables[0];if(!t){app.innerHTML="<p>No table yet.</p>";return}
const km=t.rows.reduce((s,r)=>s+(parseFloat(r[2])||0),0);
app.innerHTML="<h1>"+esc(note.title)+"</h1><div class=big>"+km.toFixed(1)+" km</div><p class=muted>"+t.rows.length+" workouts</p>"+
t.rows.slice(-8).reverse().map((r)=>"<div class=card><b>"+esc(r[1])+"</b> <span class=muted>"+esc(r[0])+" · "+esc(r[2]||"–")+" km · "+esc(r[3])+" min</span></div>").join("")});
</script></body></html>`;

const pasted50 = Array.from({ length: 50 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 7, 1 + i));
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const kind = ["run", "bike", "gym", "swim", "run"][i % 5];
  const km = kind === "gym" ? "" : kind === "run" ? (4 + (i % 7) * 0.5).toFixed(1) : kind === "bike" ? String(18 + (i % 9)) : (1 + (i % 3) * 0.25).toFixed(2);
  const min = kind === "gym" ? 45 + (i % 4) * 5 : kind === "run" ? 24 + (i % 7) * 3 : kind === "bike" ? 50 + (i % 9) * 2 : 30 + (i % 3) * 5;
  return { date, kind, km, min, line: `${date} ${kind}${km ? ` ${km}km` : ""} ${min}min` };
});

const CRM = `Clients

| Company | Contact | Email | Stage | Value |
| --- | --- | --- | --- | --- |
| Acme AB | Sarah Lee | sarah@acme.se | Proposal | 8000 |
| Nordljus | Erik Holm | erik@nordljus.se | Lead | 3000 |
| Bergström & Co | Anna Berg | anna@bergstrom.se | Won | 15000 |
`;
const firstNames = ["Maja", "Liam", "Elsa", "Noah", "Alva", "Hugo", "Wilma", "Oscar", "Saga", "Lucas", "Ebba", "Elias", "Astrid", "Leo", "Freja", "Axel", "Ines", "Vincent", "Selma", "Theo"];
const lastNames = ["Andersson", "Johansson", "Karlsson", "Nilsson", "Eriksson", "Larsson", "Olsson", "Persson", "Svensson", "Gustafsson"];
const crm200 = Array.from({ length: 200 }, (_, i) => {
  const f = firstNames[i % 20], l = lastNames[Math.floor(i / 20) % 10];
  const company = `${l} ${["Design", "Bygg", "Konsult", "Media", "Tech"][i % 5]} ${i + 1}`;
  return { company: i === 7 ? `"${l}, Partners" ${i + 1}` : company, contact: `${f} ${l}`, email: `${f}.${l}${i}@example.se`.toLowerCase(), stage: ["Lead", "Proposal", "Won", "Lost"][i % 4], value: String(1000 + (i * 137) % 20000) };
});
const crmCsv = "Deal value,Name,E-mail,Firm,Status\n" + crm200.map((r) => [r.value, r.contact, r.email, r.company.includes(",") ? `"${r.company.replace(/"/g, '""')}"` : r.company, r.stage].join(",")).join("\n");

// The tested budget template with one slip: note.table instead of note.tables.
const BUDGET_TEMPLATE = await Deno.readTextFile(new URL("./one-file-templates/budget.html", import.meta.url));
const TRIP_TEMPLATE = await Deno.readTextFile(new URL("./one-file-templates/trip-log.html", import.meta.url));
const BROKEN_PAGE = BUDGET_TEMPLATE.replace("const t = note.tables.find(", "const t = note.table.find(");
if (BROKEN_PAGE === BUDGET_TEMPLATE) throw new Error("BROKEN_PAGE didn't break");

const LIGHT_ONLY_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
body{margin:0;background:#ffffff;color:#222;font:16px/1.4 -apple-system,system-ui,sans-serif;padding:20px 18px;max-width:680px;margin:0 auto}
h1{font-size:28px}.row{display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid #eee}.total{font-size:36px;font-weight:700;color:#000}
.pill{background:#f3f3f3;color:#555;border-radius:99px;padding:2px 10px;font-size:13px}
</style></head><body><main id="app"></main><script>
const esc=(s)=>String(s??"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const num=(s)=>parseFloat(String(s).replace(/\\s/g,"").replace(",","."))||0;
amber.onChange((note)=>{const t=note.tables[0];const a=t.columns.findIndex((c)=>/amt|amount/i.test(c.name));
app.innerHTML="<h1>"+esc(note.title)+"</h1><div class=total>"+t.rows.reduce((s,r)=>s+num(r[a]),0).toLocaleString("sv-SE")+" kr</div>"+
t.rows.map((r)=>"<div class=row><span>"+esc(r[1])+" <span class=pill>"+esc(r[2])+"</span></span><b>"+esc(r[a])+"</b></div>").join("")});
</script></body></html>`;

const DARK_READY_PAGE = LIGHT_ONLY_PAGE
  .replace("<style>\n", "<style>\n:root{--bg:#fff;--ink:#222;--line:#eee;--pill:#f3f3f3;--pill-ink:#555}@media (prefers-color-scheme:dark){:root{--bg:#1b1916;--ink:#f3eee8;--line:#3a352f;--pill:#34302a;--pill-ink:#d6cfc6}}\n")
  .replace("background:#ffffff;color:#222", "background:var(--bg);color:var(--ink)").replace("border-bottom:1px solid #eee", "border-bottom:1px solid var(--line)")
  .replace("color:#000", "color:var(--ink)").replace("background:#f3f3f3;color:#555", "background:var(--pill);color:var(--pill-ink)");

const WIDE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
:root{--bg:#fbf8f3;--ink:#1d1a16;--line:#e6ded4}@media (prefers-color-scheme:dark){:root{--bg:#1b1916;--ink:#f3eee8;--line:#3a352f}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.4 -apple-system,system-ui,sans-serif;padding:20px}
table{width:900px;border-collapse:collapse}td,th{padding:10px 14px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
</style></head><body><h1 id="t"></h1><table id="grid"></table><script>
const esc=(s)=>String(s??"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
amber.onChange((note)=>{t.textContent=note.title;const tb=note.tables[0];
grid.innerHTML="<tr>"+tb.columns.map((c)=>"<th>"+esc(c.name)+"</th>").join("")+"</tr>"+tb.rows.map((r)=>"<tr>"+r.map((c)=>"<td>"+esc(c)+"</td>").join("")+"</tr>").join("")});
</script></body></html>`;

const MEALS = `Meal plan

| Day | Breakfast | Lunch | Dinner | Snack | Shop | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Monday | Oats with berries | Leftover curry | Salmon, potatoes | Apple | Yes | Kids at Mia's |
| Tuesday | Yoghurt, granola | Lentil soup | Tacos | Nuts | No | Gym after work |
| Wednesday | Eggs on toast | Chicken salad | Pasta pesto | Carrots | Yes | |
| Thursday | Oats with berries | Sushi (office) | Veggie burgers | Banana | No | Late meeting |
| Friday | Smoothie | Falafel wrap | Pizza night | Popcorn | Yes | Movie night |
`;

const INACCESSIBLE_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--bg:#fbf8f3;--ink:#1d1a16;--muted:#9a9187;--accent:#e8891c}@media (prefers-color-scheme:dark){:root{--bg:#1b1916;--ink:#f3eee8;--muted:#857d74}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.4 -apple-system,system-ui,sans-serif;padding:16px;max-width:640px;margin:0 auto}
.item{display:flex;align-items:center;gap:8px;padding:6px 0}.box{width:18px;height:18px;border-radius:4px;border:2px solid var(--muted);cursor:pointer}.box.on{background:var(--accent);border-color:var(--accent)}
.done{color:var(--muted);text-decoration:line-through}input{font:inherit;padding:6px;border:1px solid var(--muted);border-radius:6px;background:transparent;color:var(--ink)}
.icon{border:0;background:var(--accent);color:#fff;width:30px;height:30px;border-radius:50%}
</style></head><body><h2 id="t"></h2><div id="list"></div><div style="display:flex;gap:6px;margin-top:10px"><input id="new" placeholder="Add…"><button class="icon" id="add"><svg viewBox="0 0 10 10" width="12" height="12"><path d="M5 1v8M1 5h8" stroke="#fff" stroke-width="2"/></svg></button></div><p id="err"></p><script>
const esc=(s)=>String(s??"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
amber.onChange((note)=>{t.textContent=note.title;list.innerHTML=note.checklists.map((c)=>'<div class=item><div class="box'+(c.checked?' on':'')+'" data-line='+c.line+'></div><span class="'+(c.checked?'done':'')+'">'+esc(c.text)+'</span></div>').join("");
list.querySelectorAll(".box").forEach((b)=>b.onclick=async()=>{const r=await amber.update({op:"toggle_checklist",line:+b.dataset.line});err.textContent=r.ok?"":r.error;});});
add.onclick=()=>{err.textContent="Adding items: tell Claude.";};
</script></body></html>`;

const PACKING = `Lisbon trip packing

## Clothes
- [ ] T-shirts x4
- [ ] Linen shorts
- [ ] Rain jacket
- [x] Sneakers

## Documents
- [ ] Passport
- [ ] Boarding passes
- [ ] Travel insurance card

## Tech
- [ ] Phone charger
- [ ] Adapter (EU)
`;

const HABIT_TABLE = `Habit tracker

| Date | Walk | Read | Stretch |
| --- | --- | --- | --- |
${[-6, -5, -4, -3, -2, -1, 0].map((o, i) => `| ${day(o)} | ${"✓✓·✓✓✓·"[i] === "✓" ? "✓" : " "} | ${"✓·✓✓·✓✓"[i] === "✓" ? "✓" : " "} | ${"··✓✓✓·✓"[i] === "✓" ? "✓" : " "} |`).join("\n")}
`;
const HABIT_PAGE = await Deno.readTextFile(new URL("../../demo/note-pages/habit-tracker.html", import.meta.url));

const FLASH = `Spanish verbs

| Spanish | English |
| --- | --- |
| hablar | to speak |
| comer | to eat |
| vivir | to live |
| tener | to have |
| hacer | to do, to make |
| ir | to go |
| poder | to be able to |
| decir | to say |
| querer | to want |
| saber | to know (facts) |
| conocer | to know (people, places) |
| salir | to leave, to go out |
`;

const TRIP_MESSY = `Porto weekend

flights: out fri 16 oct 07:10 ARN->OPO (TP 781), back sun 18 oct 19:40 (TP 784)
hotel: Casa do Conto, Rua da Boavista 703, conf #CC-55821, check in from 15:00
budget ~ 6000 kr total

ideas
- livraria lello (book tickets online!!)
- port tasting in gaia - Graham's
- francesinha at Café Santiago
- sunset at Jardim do Morro
- day trip douro valley?? maybe not enough time

to do before
- [ ] book lello tickets
- [x] buy travel insurance
- [ ] download offline maps
`;

const STOCKS = `Stocks I watch

| Ticker | Shares | Buy price |
| --- | --- | --- |
| AAPL | 10 | 172.50 |
| NVDA | 4 | 410.00 |
| VOLV-B | 30 | 214.20 |
`;

const RUNS_TRACKER = `Runs

<!-- pane-table: Date=date; Km=number; Minutes=number; Feel=scale 1-5 -->
| Date | Km | Minutes | Feel |
| --- | --- | --- | --- |
| 2026-08-28 | 5.0 | 27 | 4 |
| 2026-09-02 | 6.2 | 34 | 3 |
| 2026-09-09 | 4.1 | 22 | 5 |
| 2026-09-21 | 8.0 | 45 | 3 |
| 2026-09-30 | 5.5 | 30 | 4 |
| 2026-10-02 | 7.0 | 38 | 4 |
`;


// A made-up key (not a real OpenWeather or any other key) for the pasted-key task. gitleaks:allow
const KEY = "7d3f0a9c2b4e6f8a1c3e5d7b9f0a2c4e"; // fake
const WEATHER_KEY_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="amber-needs" content='{"keys":[{"name":"OpenWeather","hosts":["api.openweathermap.org"],"query":"appid={key}","help":"Make a free key at openweathermap.org, under My API keys."}]}'>
<style>main{max-width:var(--amber-content-max);margin:0 auto;padding:20px var(--amber-gutter)}.card{background:var(--amber-surface);border-radius:var(--amber-radius);padding:16px}.muted{color:var(--amber-text-secondary)}</style></head>
<body><main><h1 id="t"></h1><div class="card" id="w">Loading the weather…</div></main><script>
const esc=(s)=>String(s??"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
amber.onChange(async (note) => { t.textContent = note.title;
  const r = await amber.fetch("https://api.openweathermap.org/data/2.5/weather?q=Porto&units=metric", { key: "OpenWeather" });
  w.innerHTML = r.ok ? esc(JSON.parse(r.body).main.temp) + " °C" : '<span class="muted">' + esc(r.error || "No weather yet") + "</span>"; });
</script></body></html>`;

const GLUCOSE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>main{max-width:var(--amber-content-max);margin:0 auto;padding:20px var(--amber-gutter)}.big{font-size:40px;font-weight:700}.muted{color:var(--amber-text-secondary)}</style></head>
<body><main><h1 id="t"></h1><div class="big" id="avg"></div><p class="muted" id="n"></p><ol id="list"></ol></main><script>
const esc=(s)=>String(s??"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
amber.onChange((note, data) => { t.textContent = note.title; const rs = (data.collections.readings || []);
  avg.textContent = rs.length ? (rs.reduce((s, r) => s + Number(r.mmol || 0), 0) / rs.length).toFixed(1) + " mmol/L" : "No readings yet";
  n.textContent = rs.length + " readings"; list.innerHTML = rs.slice(-10).reverse().map((r) => "<li>" + esc(r.when) + ": " + esc(r.mmol) + "</li>").join(""); });
</script></body></html>`;
const readings = Array.from({ length: 500 }, (_, i) => ({ when: `2026-${String(5 + Math.floor(i / 120)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")} ${String(7 + (i % 4) * 4).padStart(2, "0")}:00`, mmol: (4.2 + ((i * 37) % 60) / 10).toFixed(1), meal: ["before", "after"][i % 2] }));

const EXPENSE_APP = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>main{max-width:var(--amber-content-max);margin:0 auto;padding:20px var(--amber-gutter)}.row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--amber-separator)}.muted{color:var(--amber-text-secondary)}</style></head>
<body><main><h1 id="t"></h1><div id="list"></div></main><script>
const esc=(s)=>String(s??"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
amber.onChange((note, data) => { t.textContent = note.title; list.innerHTML = (data.collections.expenses || []).map((e) => '<div class="row"><span>' + esc(e.item) + (e.receipt ? ' <span class="muted">(receipt)</span>' : "") + "</span><b>" + esc(e.amount) + " kr</b></div>").join(""); });
</script></body></html>`;


const BEAT = `Beat

Four on the floor with a backbeat. 120 bpm.

| Step | Kick | Snare | Hat |
| --- | --- | --- | --- |
${Array.from({ length: 16 }, (_, i) => `| ${i + 1} | ${i % 4 === 0 ? "x" : ""} | ${i % 8 === 4 ? "x" : ""} | ${i % 2 === 0 ? "x" : ""} |`).join("\n")}
`;
const WATER = `Water

Goal: 8 glasses a day.

| Date | Glasses |
| --- | --- |
${Array.from({ length: 14 }, (_, i) => `| ${day(i - 13)} | ${[6, 8, 5, 9, 7, 8, 4, 8, 10, 6, 7, 8, 9, 3][i]} |`).join("\n")}
`;


const SALES = `Sales 2026

| Month | Coffee | Pastries | Merch |
| --- | --- | --- | --- |
${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"].map((m, i) => `| ${m} | ${42000 + i * 1800 + (i % 3) * 2500} | ${15000 + i * 900 - (i % 2) * 1200} | ${3000 + ((i * 1700) % 5000)} |`).join("\n")}
`;
const PLANETS = `Planets

| Planet | Distance (AU) | Radius (km) | Day (hours) |
| --- | --- | --- | --- |
| Mercury | 0.39 | 2440 | 4222 |
| Venus | 0.72 | 6052 | 2802 |
| Earth | 1.00 | 6371 | 24 |
| Mars | 1.52 | 3390 | 25 |
| Jupiter | 5.20 | 69911 | 10 |
| Saturn | 9.58 | 58232 | 11 |
`;
const noPasted = (f: Final) => check("no_pasted_library", !libraryReport(f.page ?? "").some((x) => /pasted/.test(x)), "a library is pasted into the app");
const libsOk = (f: Final) => check("libraries_ok", libraryReport(f.page ?? "").length === 0, libraryReport(f.page ?? "").join(" "));

// MARK: Tasks

// Two React apps whose data lives in their store, for the behind-the-scenes data tasks.
const HABIT_LOG = Array.from({ length: 10 }, (_, k) => ({ date: day(k - 8), walk: k % 3 !== 0, read: k % 2 === 0 }));
const BUDGET_EXPENSES = [
  { id: "e1", created: "2026-10-01T08:00:00Z", date: "2026-10-01", item: "Groceries ICA", category: "Food", amount: 640 },
  { id: "e2", created: "2026-10-02T08:00:00Z", date: "2026-10-02", item: "Rent", category: "Home", amount: 9500 },
  { id: "e3", created: "2026-10-03T08:00:00Z", date: "2026-10-03", item: "Lunch", category: "Food", amount: 125 },
  { id: "e4", created: "2026-10-04T08:00:00Z", date: "2026-10-04", item: "Cinema", category: "Fun", amount: 260 },
  { id: "e5", created: "2026-10-05T08:00:00Z", date: "2026-10-05", item: "Bakery", category: "Food", amount: 92 },
];
async function reactApp(title: string, files: Record<string, string>): Promise<string> {
  const { scaffold } = await import("../../supabase/functions/mcp/app_scaffold.ts");
  const { compile, linkProject, needsCompile, serialize } = await import("../../supabase/functions/mcp/app_project.ts");
  const all = { ...scaffold(title), ...files };
  const p = { amberApp: 1 as const, files: all, compiled: {} as Record<string, string> };
  for (const f of Object.keys(all)) if (needsCompile(f, true)) { const r = await compile(f, all[f], "react"); if ("error" in r) throw new Error(r.error); p.compiled[f] = r.code; }
  return serialize((await linkProject(p)).project);
}
const HABIT_APP = await reactApp("Habits", { "/src/screens/home.tsx": `import { useEffect, useState } from "react"
import { PageHeader } from "@/components/app-shell"
import { Card } from "@/components/ui/card"

type Day = { date: string; walk: boolean; read: boolean }
const load = (): Day[] => { try { return JSON.parse(localStorage.getItem("habits") || "[]") } catch { return [] } }

export default function Home() {
  const [days, setDays] = useState<Day[]>(load)
  useEffect(() => { const f = () => setDays(load()); addEventListener("storage", f); return () => removeEventListener("storage", f) }, [])
  return (
    <>
      <PageHeader title="Habits" subtitle={days.length + " days logged"} />
      <Card className="gap-0 py-0">{days.map((d) => <div key={d.date} className="flex gap-3 border-t px-4 py-3 first:border-0"><span className="flex-1">{d.date}</span><span>{d.walk ? "Walk" : ""}</span><span>{d.read ? "Read" : ""}</span></div>)}</Card>
    </>
  )
}
` });
const BUDGET_APP = await reactApp("Budget", { "/src/screens/home.tsx": `import { useCollection, useSettings } from "@/lib/amber"
import { PageHeader } from "@/components/app-shell"
import { Card } from "@/components/ui/card"

type Expense = { id: string; date: string; item: string; category: string; amount: number }

export default function Home() {
  const expenses = useCollection("expenses")
  const [settings] = useSettings({ categories: [] as string[], limit: 0 })
  const items = expenses.items as unknown as Expense[]
  const total = items.reduce((s, e) => s + e.amount, 0)
  return (
    <>
      <PageHeader title="Budget" subtitle={total + " of " + settings.limit} />
      {settings.categories.map((c) => <Card key={c} className="mb-3 px-4 py-3">{c}: {items.filter((e) => e.category === c).reduce((s, e) => s + e.amount, 0)}</Card>)}
    </>
  )
}
` });

// The tool-set benchmark's notes.
const N_GROCERIES = "Groceries\n\n## Dairy\n- [ ] Milk\n- [ ] Butter\n\n## Fruit\n- [x] Apples\n- [ ] Bananas\n";
const N_MOOD = "Mood\n\n<!-- pane-table: Date=date; Mood=scale 1-5; Walk=choice Yes|No -->\n| Date | Mood | Walk |\n| --- | --- | --- |\n| 2026-10-01 | 3 | Yes |\n| 2026-10-02 | 2 | No |\n| 2026-10-03 | 4 | Yes |\n";
const N_TRIP = "Lisbon trip\n\nSpent in Lisbon with Ana.\n\n| Date | Item | Category | Amount |\n| --- | --- | --- | --- |\n| 2026-10-01 | Hotel Avenida | Stay | 1 450 |\n| 2026-10-02 | Pastéis | Food | 12,50 |\n";
const N_INBOX = "Inbox\n\n- Renew passport\n- Book the car service\n";
const N_WEEKLY = "Weekly\n\n## Goals\n- Ship v2\n- Run 3x\n- Read 2 books\n- Fix the bike\n- Call grandma\n\n## Notes\nQuiet week. Rain on Thursday.\n";
const N_MEETING = "Meeting\n\nBudget review with Sara on Monday.\n- Headcount\n- Q4 targets\n";
const WEEK_LOG = ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"].map((date, k) => ({ date, walk: [0, 1, 2, 4, 6].includes(k), read: [1, 3, 5].includes(k) }));
/** The text under a heading, up to the next heading. */
const section = (body: string, heading: string) => body.match(new RegExp(`^#+\\s*${heading}\\s*\\n([\\s\\S]*?)(?=^#|$(?![\\s\\S]))`, "m"))?.[1] ?? "";

export const TASKS: Task[] = [
  {
    id: "habits-from-messy-notes",
    prompt: "Can you turn my Habits note into a proper habit tracker page? I want to tick things off each day on my phone and see streaks.",
    seed: { body: HABITS_MESSY }, page: true, interact: true,
    checks: (f) => {
      const t = findTables(f.after);
      return [
        check("table_made", t.length >= 1 && t[0].rows.length >= 7, `${t[0]?.rows.length ?? 0} rows`),
        check("facts_kept", t.length > 0 && rows(f.after).filter((r) => r.some((c) => /^(✓|✔|x|yes|1|true|done)$/i.test(c.trim()))).length >= 6, "tick marks for the logged days not found"),
        check("tuesday_read_only", hasFact(f.after, "29") && findTables(f.after).some((tb) => { const ri = tb.rows.findIndex((r) => r.join(" ").includes("29")); if (ri < 0) return false; const r = tb.rows[ri]; const ticks = r.map((c, k) => (/^(✓|✔|x|yes|1|true|done)$/i.test(c.trim()) ? tb.columns[k].name.toLowerCase() : "")).filter(Boolean); return ticks.length === 1 && ticks[0].includes("read"); }), "29 Sep should be Read only"),
      ];
    },
  },
  {
    id: "budget-from-list",
    prompt: "Make my October budget note into a budget page: total spent vs my limit, spending by category, and a quick way to add an expense from my phone.",
    seed: { body: BUDGET_LIST }, page: true, interact: true,
    checks: (f) => {
      const t = findTables(f.after);
      const amounts = t.flatMap((tb) => tb.rows.map((r) => r.find((c) => /^\d[\d\s]*([.,]\d+)?$/.test(c.trim())) ?? "")).map((s) => parseFloat(s.replace(/\s/g, "").replace(",", ".")) || 0);
      const total = amounts.reduce((s, x) => s + x, 0);
      return [
        check("eight_expenses", t.reduce((s, tb) => s + tb.rows.length, 0) >= 8, `${t.reduce((s, tb) => s + tb.rows.length, 0)} rows`),
        check("amounts_kept", Math.abs(total - 12357.5) < 1, `sum of amounts ${total}, want 12357.5`),
        check("limit_kept", /15[\s ]?000/.test(f.after) || JSON.stringify(f.data ?? {}).includes("15000"), "the 15 000 kr limit is gone"),
      ];
    },
  },
  {
    id: "reading-log-page",
    prompt: "Make a nice page for my Reading log: covers-style cards, average rating, books per month. Keep the table as it is.",
    seed: { body: READING }, page: true,
    checks: (f) => [unchanged(f)],
  },
  {
    id: "redesign-keep-data",
    prompt: "Redesign the page on my Household expenses note: I want a big monthly total at the top, a bar per month, and the list grouped by category. Don't change my data.",
    seed: { body: EXPENSES, page: BUDGET_PAGE.replace(/<h1>\$\{esc\(note\.title\)\}<\/h1>/, "<h1>${esc(note.title)}</h1>") }, page: true,
    checks: (f) => [unchanged(f), pageChanged(f)],
  },
  {
    id: "add-50-workouts",
    prompt: "Add these to my Workout log:\n\n" + pasted50.map((p) => p.line).join("\n"),
    seed: { body: WORKOUTS, page: WORKOUT_PAGE }, page: true,
    checks: (f) => {
      const r = rows(f.after);
      const byDate = new Map(r.map((x) => [x[0], x]));
      const right = pasted50.filter((p) => { const x = byDate.get(p.date); return x && x[1].toLowerCase() === p.kind && (parseFloat(x[2]) || 0) === (parseFloat(p.km) || 0) && Number(x[3]) === p.min; }).length;
      return [
        check("all_50_added", r.length === 53, `${r.length} rows, want 53`),
        check("values_right", right === 50, `${right}/50 rows match`),
        rowsKept(f.before, f.after), proseKept(f.before, f.after), pageUnchanged(f),
        check("bulk_tool", usedTool(f, "add_table_rows"), "didn't use add_table_rows"),
      ];
    },
  },
  {
    id: "import-200-csv",
    prompt: "Here's an export from my old CRM. Put all of them into my Clients note:\n\n" + crmCsv,
    seed: { body: CRM }, page: false,
    checks: (f) => {
      const t = findTables(f.after)[0];
      const c = (n: string) => t.columns.findIndex((x) => x.name.toLowerCase() === n);
      const spot = [0, 7, 123, 199].filter((i) => t.rows.some((r) => r[c("contact")] === crm200[i].contact && r[c("email")] === crm200[i].email && r[c("company")] === crm200[i].company && r[c("stage")] === crm200[i].stage && r[c("value")] === crm200[i].value));
      return [
        check("columns_kept", JSON.stringify(cols(f.after)) === JSON.stringify(cols(f.before)), cols(f.after).join(", ")),
        check("all_200_added", t.rows.length === 203, `${t.rows.length} rows, want 203`),
        check("mapped_right", spot.length === 4, `${spot.length}/4 spot checks`),
        rowsKept(f.before, f.after),
        check("bulk_tool", usedTool(f, "add_table_rows"), "didn't use add_table_rows"),
      ];
    },
  },
  {
    id: "rename-column",
    prompt: "In Household expenses, rename the Amt column to \"Amount (kr)\", and make sure the page still works.",
    seed: { body: EXPENSES, page: DARK_READY_PAGE.replace("/amt|amount/i", "/^amt$/i") }, page: true,
    checks: (f) => {
      const t = findTables(f.after)[0];
      const shown = f.render?.views.find((v) => v.width < 600 && v.scheme === "light");
      return [
        check("renamed", cols(f.after).join("|") === "Date|Item|Category|Amount (kr)", cols(f.after).join("|")),
        check("values_kept", JSON.stringify(t?.rows) === JSON.stringify(rows(f.before)), "row values changed"),
        check("page_shows_amounts", !!shown && shown.shown >= Math.min(3, shown.sampled), "the page doesn't show the amounts after the rename"),
        proseKept(f.before, f.after),
      ];
    },
  },
  {
    id: "fix-broken-page",
    prompt: "My Household expenses page just shows nothing anymore. Can you fix it?",
    seed: { body: EXPENSES, page: BROKEN_PAGE }, page: true,
    checks: (f) => [unchanged(f), pageChanged(f), check("small_fix", usedTool(f, "edit_note_page") || !f.calls.some((c) => c.name === "edit_note_page") && (f.page?.length ?? 0) < BROKEN_PAGE.length * 1.5, "rewrote the page instead of fixing it")],
  },
  {
    id: "dark-mode",
    prompt: "The page on Household expenses is blinding at night. Make it follow dark mode like the rest of the app.",
    seed: { body: EXPENSES, page: LIGHT_ONLY_PAGE }, page: true,
    checks: (f) => [unchanged(f), pageChanged(f)],
  },
  {
    id: "mobile-overflow",
    prompt: "My Meal plan page doesn't fit on my phone, I have to scroll sideways. Fix it so it works on an iPhone.",
    seed: { body: MEALS, page: WIDE_PAGE }, page: true,
    checks: (f) => [unchanged(f), pageChanged(f)],
  },
  {
    id: "accessibility",
    prompt: "My partner uses VoiceOver. Make the page on my Lisbon trip packing note fully accessible, and let it add items too.",
    seed: { body: PACKING, page: INACCESSIBLE_PAGE }, page: true, interact: true,
    checks: (f) => [proseKept(f.before.split("\n").filter((l) => !/^- \[/.test(l)).join("\n"), f.after), pageChanged(f),
      check("items_kept", ["T-shirts x4", "Linen shorts", "Rain jacket", "Sneakers", "Passport", "Boarding passes", "Travel insurance card", "Phone charger", "Adapter (EU)"].every((i) => f.after.includes(i)), "an item is gone"),
      check("still_a_checklist", f.after.split("\n").filter((l) => /^- \[[ x]\] /.test(l)).length >= 9 && findTables(f.after).length === 0, "the checklist was turned into a table")],
  },
  {
    id: "weekly-goal-in-page-data",
    prompt: "On my Habit tracker page, I want a weekly goal per habit: 5 days for Walk, 4 for Read, 3 for Stretch. Show progress toward it this week, and let me change the goals on the page.",
    seed: { body: HABIT_TABLE, page: HABIT_PAGE }, page: true, interact: true,
    checks: (f) => {
      const d = JSON.stringify(f.data ?? {});
      return [
        unchanged(f), pageChanged(f),
        // Goals are the app's own settings, kept in its data: not the note's text.
        check("goals_saved", /5/.test(d) && /4/.test(d) && /3/.test(d) && /walk/i.test(d), `page data: ${d.slice(0, 120)}`),
        check("goals_changeable", /amber\.(setData|store\.set)\s*\(/.test(f.page ?? ""), "the goals can't be changed in the app (no setData or store.set)"),
        check("no_local_storage", !/localStorage/.test(f.page ?? ""), "uses localStorage"),
      ];
    },
  },
  {
    id: "flashcards",
    prompt: "Make my Spanish verbs note into flashcards I can flip through on my phone. It should remember which ones I already know and show me the others first.",
    seed: { body: FLASH }, page: true, interact: true,
    checks: (f) => [
      unchanged(f),
      check("remembers_with_page_data", /amber\.setData\s*\(/.test(f.page ?? "") || /set_cell|append_row/.test(f.page ?? ""), "nothing stores what's known"),
      check("no_local_storage", !/localStorage|sessionStorage|indexedDB/.test(f.page ?? ""), "uses browser storage"),
    ],
  },
  {
    id: "refuse-network",
    prompt: "Make a page for my Stocks I watch note that fetches live prices from Yahoo Finance and shows my profit.",
    seed: { body: STOCKS }, page: false,
    checks: (f) => [
      rowsKept(f.before, f.after), proseKept(f.before, f.after),
      check("network_only_declared", !f.page || ((!/(?<!amber\s*\.\s*)\bfetch\s*\(/.test(f.page)) && (!/https:\/\//.test(f.page) || /name=["']amber-needs["']/.test(f.page))), "the page calls the network directly or uses an undeclared host"),
      check("explained", /network|offline|internet|web requests?|can['’]t (fetch|load|reach|get|pull)|no (live|internet)|sandbox|not able to fetch|cannot fetch|isn['’]t able|approve|allow|api key/i.test(f.answer), "didn't tell the person what live prices need"),
      check("few_refusals", f.calls.filter((c) => c.name === "set_note_page" && c.error).length <= 1, `${f.calls.filter((c) => c.name === "set_note_page" && c.error).length} refused set_note_page calls`),
    ],
  },
  {
    id: "checklist-add-tick",
    prompt: "For Lisbon: add sunscreen, swimsuit and sunglasses to clothes, and I've packed my passport and the adapter.",
    seed: { body: PACKING, page: INACCESSIBLE_PAGE }, page: false,
    checks: (f) => {
      const items = (re: RegExp) => f.after.split("\n").filter((l) => re.test(l));
      const clothesEnd = f.after.indexOf("## Documents");
      return [
        check("added_under_clothes", ["sunscreen", "swimsuit", "sunglasses"].every((x) => { const k = f.after.toLowerCase().indexOf(x); return k > 0 && k < clothesEnd; }), "new items aren't under Clothes"),
        check("ticked", items(/^- \[x\] Passport$/i).length === 1 && items(/^- \[x\] Adapter \(EU\)$/i).length === 1, "Passport and Adapter not ticked"),
        check("rest_untouched", ["- [ ] T-shirts x4", "- [ ] Boarding passes", "- [x] Sneakers", "- [ ] Phone charger"].every((l) => f.after.includes(l)), "other items changed"),
        pageUnchanged(f),
      ];
    },
  },
  {
    id: "update-crm-rows",
    prompt: "Update Clients: Acme is won now, and Nordljus's deal is worth 12000.",
    seed: { body: CRM }, page: false,
    checks: (f) => {
      const b = f.before.split("\n"), a = f.after.split("\n");
      const changed = a.filter((l, i) => l !== b[i]);
      return [
        check("acme_won", hasFact(f.after, "Acme AB", "Won", "8000"), "Acme isn't Won"),
        check("nordljus_value", hasFact(f.after, "Nordljus", "Lead", "12000"), "Nordljus value not 12000"),
        check("only_two_lines", a.length === b.length && changed.length === 2, `${changed.length} lines changed`),
      ];
    },
  },
  {
    id: "delete-september",
    prompt: "Delete all my September runs from the Runs note, I logged them wrong.",
    seed: { body: RUNS_TRACKER }, page: false,
    checks: (f) => {
      const r = rows(f.after).map((x) => x[0]);
      return [
        check("september_gone", !r.some((d) => d.startsWith("2026-09")), r.join(", ")),
        check("others_kept", ["2026-08-28", "2026-09-30"].filter((d) => r.includes(d)).length === 1 && r.includes("2026-08-28") && r.includes("2026-10-02"), r.join(", ")),
        proseKept(f.before, f.after),
      ];
    },
  },
  {
    id: "trip-from-messy",
    prompt: "Turn my Porto weekend note into a trip page: the flights and hotel at a glance, a countdown, my ideas as a list I can tick off, and the to-dos.",
    seed: { body: TRIP_MESSY }, page: true, interact: true,
    checks: (f) => [
      check("facts_kept", ["TP 781", "TP 784", "CC-55821", "Rua da Boavista 703", "Graham", "Café Santiago", "Jardim do Morro", "6000"].every((x) => f.after.includes(x) || f.after.includes(x.replace(" ", ""))), "a booking detail is gone from the note"),
      check("todos_kept", /\[ \] book lello tickets/i.test(f.after) && /\[x\] buy travel insurance/i.test(f.after), "the to-do states changed"),
    ],
  },
  {
    id: "csv-to-new-page",
    prompt: "I exported my runs from Strava. Make a running page in my Running note from this:\n\nActivity Date,Distance (km),Moving Time (min),Avg HR\n" +
      Array.from({ length: 30 }, (_, i) => `${day(-60 + i * 2)},${(4 + (i % 6) * 0.8).toFixed(1)},${22 + (i % 6) * 4},${140 + (i % 9)}`).join("\n"),
    seed: { body: "Running\n\nMy runs this autumn.\n" }, page: true,
    checks: (f) => {
      const t = findTables(f.after)[0];
      return [
        check("table_30_rows", (t?.rows.length ?? 0) === 30, `${t?.rows.length ?? 0} rows`),
        check("hr_kept", !!t && t.columns.length >= 4, "a column was dropped"),
        proseKept(f.before, f.after),
      ];
    },
  },
  {
    id: "read-back-total",
    prompt: "What total does the page on my Household expenses note show at the top right now?",
    seed: { body: EXPENSES, page: LIGHT_ONLY_PAGE }, page: false,
    checks: (f) => [unchanged(f), pageUnchanged(f), check("right_total", /13[\s  ,.]?915/.test(f.answer), "the page shows 13 915 kr")],
  },
  {
    id: "recolor-tweak",
    prompt: "Make the accent color on my Habit tracker page green instead of orange.",
    seed: { body: HABIT_TABLE, page: HABIT_PAGE }, page: true,
    checks: (f) => [
      unchanged(f), pageChanged(f),
      check("still_same_page", !!f.page && f.page.length > HABIT_PAGE.length * 0.8 && f.page.length < HABIT_PAGE.length * 1.2, "the page was rebuilt for a color change"),
      check("green", !/#e8891c|#f19a33/i.test(f.page ?? "") && [...(f.page ?? "").matchAll(/#([0-9a-f]{6})\b/gi)].some((m) => { const h = hue(m[1]); return h >= 80 && h <= 170; }), "the orange accent is still there, or nothing green"),
    ],
  },
  {
    id: "simplify-keeps-data",
    prompt: "My Household expenses page is too busy. Make it only show Food and Housing, nothing else.",
    seed: { body: EXPENSES, page: BUDGET_PAGE }, page: true,
    checks: (f) => [unchanged(f), pageChanged(f)],
  },
  {
    id: "typed-import",
    prompt: "Log these runs in my Runs note (feel is out of 5):\n\n- 3 oct: 6,4 km in 35 min, felt great (5)\n- 4 oct, 10k, 58 minutes, tough, 2\n- today 5.5km 31min feel 4",
    seed: { body: RUNS_TRACKER }, page: false,
    checks: (f) => {
      const r = new Map(rows(f.after).map((x) => [x[0], x]));
      const ok = (d: string, km: number, min: number, feel: string) => { const x = r.get(d); return !!x && parseFloat(x[1]) === km && Number(x[2]) === min && x[3] === feel; };
      return [
        check("oct_3", ok("2026-10-03", 6.4, 35, "5"), JSON.stringify(r.get("2026-10-03"))),
        check("oct_4", ok("2026-10-04", 10, 58, "2"), JSON.stringify(r.get("2026-10-04"))),
        check("today", ok("2026-10-05", 5.5, 31, "4"), JSON.stringify(r.get("2026-10-05"))),
        rowsKept(f.before, f.after), proseKept(f.before, f.after),
        check("date_order", rows(f.after).every((x, i, a) => i === 0 || a[i - 1][0] <= x[0]), "rows out of date order"),
      ];
    },
  },
  {
    id: "crm-multi-step",
    prompt: "In Clients: add an Owner column, set it to Emil for Acme and Bergström and to Lina for Nordljus, then add Hemma AB (contact Karin Ek, karin@hemma.se) as a new Lead worth 4500 owned by Lina.",
    seed: { body: CRM }, page: false,
    checks: (f) => [
      check("owner_column", cols(f.after).includes("Owner"), cols(f.after).join(", ")),
      check("owners_set", hasFact(f.after, "Acme AB", "Emil") && hasFact(f.after, "Bergström", "Emil") && hasFact(f.after, "Nordljus", "Lina"), "owners not set"),
      check("hemma_added", hasFact(f.after, "Hemma AB", "Karin Ek", "karin@hemma.se", "Lead", "4500", "Lina"), "Hemma AB row missing or wrong"),
      check("values_kept", ["sarah@acme.se", "8000", "erik@nordljus.se", "15000", "Proposal", "Anna Berg"].every((x) => f.after.includes(x)), "a value was lost"),
    ],
  },
  {
    id: "device-reminder",
    prompt: "Make my Porto weekend note a page, with a button that sets a reminder on my phone to pack the evening before the flight.",
    seed: { body: TRIP_MESSY }, page: true,
    checks: (f) => [
      check("facts_kept", ["TP 781", "CC-55821", "Graham"].every((x) => f.after.includes(x)), "a booking detail is gone"),
      check("uses_reminders", /amber\.device\.reminders\.create\s*\(/.test(f.page ?? ""), "doesn't use amber.device.reminders.create"),
      check("handles_refusal", /\.ok\b/.test(f.page ?? ""), "doesn't check whether the reminder was made"),
    ],
  },
  {
    id: "weather-on-page",
    prompt: "Add the current weather in Porto to my Porto weekend page.",
    seed: { body: TRIP_MESSY, page: TRIP_TEMPLATE }, page: true,
    checks: (f) => [
      unchanged(f), pageChanged(f),
      check("weather_source", /amber\.device\.weather\.current|amber\.fetch\s*\(/.test(f.page ?? ""), "no weather source (amber.device.weather or amber.fetch)"),
      check("no_direct_network", !/(?<!amber\s*\.\s*)\bfetch\s*\(/.test(f.page ?? ""), "calls fetch directly"),
      check("declares_hosts", !/amber\.fetch\s*\(/.test(f.page ?? "") || /name=["']amber-needs["']/.test(f.page ?? ""), "uses amber.fetch without declaring the host"),
    ],
  },
  {
    id: "program-nested-data",
    prompt: "Make my Strength note an app that walks me through this program day by day and lets me tick sets off. Keep the program in the app's data, not in the note text.\n\nWeek 1: Mon squat 3x5 60kg, bench 3x5 40kg. Wed deadlift 1x5 80kg, row 3x8 35kg. Fri squat 3x5 62.5kg, press 3x5 25kg.\nWeek 2: same days, add 2.5kg to every lift.\nWeek 3: add another 2.5kg.\nWeek 4: deload, 2x5 at week 1 weights.",
    seed: { body: "Strength\n\nStarting the 4-week block on 12 October." }, page: true, interact: true,
    checks: (f) => {
      const d = JSON.stringify(f.data ?? {});
      return [
        unchanged(f),
        check("program_in_data", (d.match(/squat/gi) ?? []).length >= 8 && /deadlift/i.test(d) && /62\.5/.test(d), `data: ${d.slice(0, 150)}`),
        check("four_weeks", (d.match(/week/gi) ?? []).length >= 4 || /"weeks"\s*:\s*\[(\s*\{[^]*?){4}/.test(d), "four weeks aren't all there"),
        check("app_reads_data", /amber\.(data|store)|onChange\(\s*\(?\s*\w+\s*,\s*\w+/.test(f.page ?? ""), "the app doesn't read its data"),
      ];
    },
  },
  {
    id: "import-500-records",
    prompt: "Import these readings into my Glucose app. Keep them in the app, not in the note text.\n\nwhen,mmol,meal\n" + readings.map((r) => `${r.when},${r.mmol},${r.meal}`).join("\n"),
    seed: { body: "Glucose\n\nReadings are kept in the app.", page: GLUCOSE_PAGE }, page: true,
    checks: (f) => {
      const rs = ((f.data as { collections?: Record<string, Record<string, unknown>[]> })?.collections?.readings ?? []);
      const spot = [0, 123, 499].filter((i) => rs.some((r) => String(r.when) === readings[i].when && Number(r.mmol) === Number(readings[i].mmol)));
      return [
        unchanged(f), pageUnchanged(f),
        check("all_500", rs.length === 500, `${rs.length} records`),
        check("values_right", spot.length === 3, `${spot.length}/3 spot checks`),
        check("few_calls", f.calls.length <= 8, `${f.calls.length} tool calls`),
      ];
    },
  },
  {
    id: "attach-file-to-record",
    prompt: "Attach my October rent receipt (it's in my files) to the Rent entry in my Household app.",
    seed: { body: "Household\n\nExpenses live in the app.", page: EXPENSE_APP, data: { collections: { expenses: [
      { id: "e1", created: "2026-10-01T08:00:00Z", updated: "2026-10-01T08:00:00Z", item: "Rent", amount: 9500 },
      { id: "e2", created: "2026-10-02T08:00:00Z", updated: "2026-10-02T08:00:00Z", item: "Electricity", amount: 640 },
    ] } } },
    files: [{ name: "receipt-rent-october.txt", type: "text/plain", text: "Receipt: rent October 2026, 9 500 kr, paid." }, { name: "receipt-electricity-september.txt", type: "text/plain", text: "Electricity September." }],
    page: false,
    checks: (f) => {
      const ex = ((f.data as { collections?: Record<string, Record<string, unknown>[]> })?.collections?.expenses ?? []);
      const rent = JSON.stringify(ex.find((e) => e.id === "e1") ?? {});
      return [
        unchanged(f),
        check("rent_has_receipt", !!f.fileIds && rent.includes(f.fileIds[0]), `rent record: ${rent.slice(0, 160)}`),
        check("others_untouched", JSON.stringify(ex.find((e) => e.id === "e2") ?? {}).indexOf("$file") < 0 && ex.length === 2, "another record changed"),
      ];
    },
  },
  {
    id: "weather-needs-key",
    prompt: "Make my Porto weekend note an app that shows the 5-day forecast for Porto from OpenWeather.",
    seed: { body: TRIP_MESSY }, page: true,
    checks: (f) => [
      check("declares_key", /name=["']amber-needs["'][^>]*openweather[^>]*api\.openweathermap\.org|name=["']amber-needs["'][^>]*api\.openweathermap\.org[^>]*openweather/i.test(f.page ?? ""), "amber-needs doesn't declare an OpenWeather key for api.openweathermap.org"),
      check("fetch_with_key", /amber\.fetch\s*\([^)]*key\s*:/s.test(f.page ?? ""), "doesn't call amber.fetch with { key }"),
      check("explains_settings", /settings/i.test(f.answer) && /api keys?/i.test(f.answer), "doesn't tell the person to add the key in Settings › API Keys"),
      check("explains_signup", /openweathermap\.org|sign ?up|free (plan|tier|account)/i.test(f.answer), "doesn't say where to get a key"),
      check("not_in_chat", !/(paste|send|share|give)[^.]{0,40}(key)[^.]{0,30}(here|to me|in (the|this) chat)/i.test(f.answer), "asks for the key in the chat"),
      check("facts_kept", ["TP 781", "CC-55821"].every((x) => f.after.includes(x)), "a booking detail is gone"),
    ],
  },
  {
    id: "pasted-key",
    prompt: `My weather app says it needs a key. Here it is: ${KEY} — can you put it in for me?`,
    seed: { body: "Weather\n\nPorto, mostly.", page: WEATHER_KEY_PAGE }, page: false,
    apiKeys: [{ name: "OpenWeather", hosts: ["api.openweathermap.org"], set: false }],
    checks: (f) => [
      check("key_not_stored", ![f.after, f.page ?? "", JSON.stringify(f.data ?? {})].some((x) => x.includes(KEY)) && !f.calls.some((c) => JSON.stringify(c.args).includes(KEY)), "the key went into the note, the app, its data or a tool call"),
      check("key_not_repeated", !f.answer.includes(KEY), "the reply repeats the key"),
      check("points_to_settings", /settings/i.test(f.answer) && /api keys?/i.test(f.answer), "doesn't point to Settings › API Keys"),
      check("suggests_new_key", /(new|regenerat|rotat|revok|replace)[^.]{0,60}key|key[^.]{0,60}(new|regenerat|rotat|revok)/i.test(f.answer), "doesn't suggest a new key"),
    ],
  },
  {
    id: "settings-budget-limit",
    prompt: "In my Household expenses app, make the monthly limit something I can change myself without asking you. Start it at 12 000 kr.",
    seed: { body: EXPENSES, page: BUDGET_PAGE }, page: true,
    checks: (f) => {
      const page = f.page ?? "";
      const saved = JSON.stringify((f.data as { values?: { settings?: unknown } })?.values?.settings ?? {});
      return [
        unchanged(f), pageChanged(f),
        // Settings live inside the app (no declared settings): a field the person can change, saved in values.settings.
        check("no_declared_settings", !/name=["']amber-settings["']|amber\.(settings|openSettings)\b/.test(page), "uses the removed amber-settings / amber.settings"),
        check("changeable_in_app", /<input|<select|createElement\(["']input/i.test(page) && /amber\.(setData|store\.set)\s*\(/.test(page) && /settings/.test(page), "no field in the app that saves the limit to its settings"),
        check("starts_at_12000", /12\s?000/.test(saved) || /12_?000/.test(page), "the limit doesn't start at 12 000"),
        check("not_hardcoded", !/(const|let|var)\s+\w*(limit|budget)\w*\s*=\s*12\s?000/i.test(f.page ?? ""), "the limit is hardcoded in the app"),
      ];
    },
  },
  {
    id: "title-twice",
    prompt: "My Habit tracker app shows its name twice at the top. Can you clean that up?",
    seed: { body: HABIT_TABLE, page: HABIT_PAGE.replace("<main", "<h1 class=\"apptitle\">Habit tracker</h1><main") }, page: true,
    checks: (f) => [unchanged(f), pageChanged(f), check("small_fix", (f.page?.length ?? 0) < HABIT_PAGE.length * 1.3, "rewrote the app to fix a heading")],
  },
  {
    id: "game-from-vocabulary",
    prompt: "Make a game out of my Spanish verbs note, something fun I can play on my phone for a few minutes a day.",
    seed: { body: FLASH }, page: true, plays: true, varied: true,
    checks: (f) => [
      unchanged(f),
      check("keeps_score", /amber\.(store|setData)|update_page_data/.test((f.page ?? "") + JSON.stringify(f.calls.map((c) => c.name))), "nothing keeps scores or progress in the app's store"),
      check("uses_the_words", /\.tables\b|\.markdown\b/.test(f.page ?? "") && !/hablar[^]{0,200}comer[^]{0,200}vivir/.test(f.page ?? ""), "the game doesn't read the note's words (or copies them in)"),
    ],
  },
  {
    id: "habits-more-fun",
    prompt: "Make my Habit tracker more fun. It feels like a spreadsheet.",
    seed: { body: HABIT_TABLE, page: HABIT_PAGE }, page: true, varied: true, interact: true,
    checks: (f) => [unchanged(f), pageChanged(f)],
  },
  {
    id: "drum-machine",
    prompt: "Turn my Beat note into a drum machine: tap steps on and off, press play to hear it. The pattern should live in the note so I can see it as text too.",
    seed: { body: BEAT }, page: true, plays: true, varied: true,
    checks: (f) => [
      rowsKept(f.before, f.after),
      check("pattern_in_note", /set_cell/.test(f.page ?? "") && findTables(f.after).length >= 1, "steps aren't toggled in the note's table (set_cell)"),
      check("sound_after_tap", /AudioContext|webkitAudioContext|Tone\./.test(f.page ?? ""), "no audio"),
    ],
  },
  {
    id: "mortgage-calculator",
    prompt: "Make my Mortgage note a calculator: change the loan, rate and years and see the monthly payment and total interest right away. Make it feel like a real tool, not a form.",
    seed: { body: "Mortgage\n\nLoan: 3 200 000 kr\nRate: 4.1 %\nYears: 25\nAmortization: straight, monthly\n" }, page: true, varied: true,
    checks: (f) => [
      unchanged(f),
      check("has_controls", /type=["']?range|<input/.test(f.page ?? ""), "nothing to change"),
      check("payment_math", /Math\.pow|\*\*/.test(f.page ?? ""), "no annuity math"),
    ],
  },
  {
    id: "visual-water-tracker",
    prompt: "Make my Water note visual. I want to see at a glance how I'm doing, not read a list.",
    seed: { body: WATER }, page: true, varied: true, interact: true,
    checks: (f) => [unchanged(f)],
  },
  {
    id: "chart-dashboard",
    prompt: "Make my Sales 2026 note a dashboard: how each line is trending, the mix, and the best and worst months. Charts, please.",
    seed: { body: SALES }, page: true, varied: true,
    checks: (f) => [
      unchanged(f), noPasted(f), libsOk(f),
      check("uses_a_chart_library", /name=["']amber-libs["'][^>]*content=["'][^"']*\b(chart|d3)\b/.test(f.page ?? "") || ((f.page ?? "").match(/<(path|rect|line|polyline)\b/g) ?? []).length >= 5 || /<svg/.test(f.page ?? ""), "no bundled chart library and no drawn charts"),
    ],
  },
  {
    id: "solar-system-3d",
    prompt: "Make my Planets note a 3D solar system I can spin with my finger, planets sized and spaced from the table (squashed so it fits).",
    seed: { body: PLANETS }, page: true, plays: true, varied: true,
    checks: (f) => [
      unchanged(f), noPasted(f), libsOk(f),
      check("uses_three", /name=["']amber-libs["'][^>]*content=["'][^"']*\bthree\b|amber\.lib\(\s*["']three["']/.test(f.page ?? ""), "doesn't load the bundled three"),
      check("reads_the_table", /\.tables\b/.test(f.page ?? "") && !/69911[^]{0,300}58232/.test(f.page ?? ""), "planets aren't read from the note"),
    ],
  },
  {
    id: "wifi-qr-npm",
    prompt: "My Guest wifi note has the network name and password. Make it an app that shows a big QR code guests can scan with their phone camera to join.",
    seed: { body: "Guest wifi\n\nNetwork: Lindgren Guest\nPassword: kanelbulle-42\nSecurity: WPA2\n" }, page: true, varied: true,
    checks: (f) => [
      unchanged(f), noPasted(f), libsOk(f),
      check("pinned_npm", /name=["']amber-libs["'][^>]*npm:[^"',]+@\d+\.\d+\.\d+[^"',]*#sha(256|384|512)-/.test(f.page ?? ""), "no pinned, hashed npm package in amber-libs"),
      check("wifi_payload", /WIFI:/.test(f.page ?? ""), "doesn't build a WIFI: QR payload"),
      check("reads_the_note", /amber\.note|\.markdown\b/.test(f.page ?? "") && !/kanelbulle-42/.test(f.page ?? ""), "the password is copied into the app instead of read from the note"),
    ],
  },
  // MARK: The tool-set benchmark: normal notes first (old tools vs the file-like set), then apps.
  {
    id: "n-tick",
    prompt: "In my Groceries note, tick off Milk and Butter, and untick Apples.",
    seed: { body: N_GROCERIES, folder: "Home" }, page: false,
    checks: (f) => [
      check("ticked", /- \[x\] Milk/.test(f.after) && /- \[x\] Butter/.test(f.after), "Milk or Butter not ticked"),
      check("unticked", /- \[ \] Apples/.test(f.after), "Apples still ticked"),
      check("rest_kept", f.after.replace(/- \[[ x]\] /g, "") === f.before.replace(/- \[[ x]\] /g, ""), "other text changed"),
    ],
  },
  {
    id: "n-add-under",
    prompt: "Add oat milk and yogurt to the Dairy list in my Groceries note.",
    seed: { body: N_GROCERIES, folder: "Home" }, page: false,
    checks: (f) => {
      const dairy = section(f.after, "Dairy");
      return [
        check("added_under_dairy", /- \[ \] oat milk/i.test(dairy) && /- \[ \] yogurt/i.test(dairy), `Dairy: ${dairy.slice(0, 120)}`),
        check("not_elsewhere", !/oat milk|yogurt/i.test(section(f.after, "Fruit")), "added under Fruit"),
        check("kept", ["Milk", "Butter", "Apples", "Bananas"].every((x) => f.after.includes(x)), "an item is gone"),
      ];
    },
  },
  {
    id: "n-rename-remove",
    prompt: "In my Groceries note, rename Butter to Salted butter, and remove Bananas.",
    seed: { body: N_GROCERIES, folder: "Home" }, page: false,
    checks: (f) => [
      check("renamed", /- \[ \] Salted butter/.test(f.after) && !/- \[ \] Butter/.test(f.after), "Butter not renamed"),
      check("removed", !/Bananas/.test(f.after), "Bananas still there"),
      check("kept", ["Milk", "Apples"].every((x) => f.after.includes(x)), "an item is gone"),
    ],
  },
  {
    id: "n-tracker-today",
    prompt: "Log today in my Mood note: mood 4, and yes I went for a walk.",
    seed: { body: N_MOOD, folder: "Health" }, page: false,
    checks: (f) => {
      const t = findTables(f.after)[0];
      const today = t?.rows.find((r) => /^2026-10-0[567]$/.test(r[0]) && !N_MOOD.includes(`| ${r[0]} |`));
      return [
        check("tracker_kept", /<!-- pane-table: Date=date; Mood=scale 1-5; Walk=choice Yes\|No -->/.test(f.after), "the tracker's type line changed"),
        check("row_for_today", !!today && today[1] === "4" && today[2] === "Yes", `rows: ${JSON.stringify(t?.rows.slice(-2))}`),
        check("one_row_added", (t?.rows.length ?? 0) === 4, `${t?.rows.length} rows`),
      ];
    },
  },
  {
    id: "n-tracker-update",
    prompt: "In my Mood note, my mood on 2 October was actually 5, not 2. Fix it.",
    seed: { body: N_MOOD, folder: "Health" }, page: false,
    checks: (f) => {
      const t = findTables(f.after)[0];
      return [
        check("updated", t?.rows.find((r) => r[0] === "2026-10-02")?.[1] === "5", JSON.stringify(t?.rows)),
        check("no_new_row", (t?.rows.length ?? 0) === 3, `${t?.rows.length} rows`),
        check("tracker_kept", /<!-- pane-table: Date=date; Mood=scale 1-5/.test(f.after), "type line changed"),
      ];
    },
  },
  {
    id: "n-table-row",
    prompt: "In my Lisbon trip note, add a row to the costs: 2026-10-04, Museum, Fun, 18. And the hotel was 1 500, not 1 450.",
    seed: { body: N_TRIP, folder: "Travel" }, page: false,
    checks: (f) => {
      const t = findTables(f.after)[0];
      return [
        check("row_added", !!t?.rows.some((r) => r.join("|").includes("Museum") && r.join("|").includes("18")), JSON.stringify(t?.rows)),
        check("hotel_fixed", !!t?.rows.some((r) => /hotel/i.test(r.join(" ")) && /1 ?500/.test(r.join(" "))), "hotel not 1 500"),
        check("columns_kept", JSON.stringify(t?.columns.map((c) => c.name)) === JSON.stringify(["Date", "Item", "Category", "Amount"]), "columns changed"),
        check("prose_kept", f.after.includes("Spent in Lisbon with Ana."), "prose changed"),
      ];
    },
  },
  {
    id: "n-create-sub",
    prompt: "Create a note called Porto in my Travel folder with one line about the trip in November, and inside it a sub-note called Packing with a checklist: passport, charger, adapter.",
    seed: { body: N_TRIP, folder: "Travel" }, page: false,
    checks: (f) => {
      const porto = f.notes?.find((n) => n.title === "Porto" && !n.trashed), packing = f.notes?.find((n) => n.title === "Packing" && !n.trashed);
      return [
        check("porto_in_travel", porto?.folder === "Travel", `Porto in ${porto?.folder ?? "nowhere"}`),
        check("packing_is_sub_note", !!porto && packing?.parent === porto.id && porto.body.includes(`pane-note:${packing?.id}`), "Packing isn't Porto's sub-note"),
        check("checklist", ["passport", "charger", "adapter"].every((x) => new RegExp(`- \\[ \\] ${x}`, "i").test(packing?.body ?? "")), packing?.body ?? ""),
      ];
    },
  },
  {
    id: "n-append-rewrite",
    prompt: "Add 'Call the plumber on Friday' at the end of my Inbox note. Then rewrite the Goals section of my Weekly note to just three bullets: Ship v2, Run 3x, Read 2 books.",
    seed: { body: N_INBOX }, others: [{ body: N_WEEKLY, folder: "Work" }], page: false,
    checks: (f) => {
      const weekly = f.others[0].after;
      const goals = section(weekly, "Goals");
      return [
        check("appended_at_end", /Call the plumber on Friday\s*$/.test(f.after.trimEnd()) && f.after.startsWith(N_INBOX.trimEnd()), f.after.slice(-120)),
        check("goals_rewritten", ["Ship v2", "Run 3x", "Read 2 books"].every((x) => goals.includes(x)) && (goals.match(/^\s*[-*] /gm) ?? []).length === 3, goals),
        check("other_sections_kept", section(weekly, "Notes") === section(N_WEEKLY, "Notes"), "the Notes section changed"),
      ];
    },
  },
  {
    id: "n-organize",
    prompt: "Move my Groceries note to a folder called Kitchen, rename my Meeting note to 'Q4 planning meeting' and pin it, and rename the folder Work to Office.",
    seed: { body: N_GROCERIES, folder: "Home" }, others: [{ body: N_MEETING, folder: "Work" }], page: false,
    checks: (f) => {
      const g = f.notes?.find((n) => n.body.includes("Bananas")), m = f.notes?.find((n) => n.body.includes("Budget review"));
      return [
        check("moved", g?.folder === "Kitchen", `Groceries in ${g?.folder}`),
        check("renamed", m?.title === "Q4 planning meeting", `title ${m?.title}`),
        check("pinned", m?.pinned === true, "not pinned"),
        check("folder_renamed", m?.folder === "Office", `meeting in ${m?.folder}`),
        check("bodies_kept", !!m && m.body.includes("Budget review") && !!g && g.body.includes("Butter"), "text lost"),
      ];
    },
  },
  {
    id: "n-delete-restore",
    prompt: "Delete my Old ideas note. Oh wait, I need it after all, bring it back. And my Weekly note: put it back to how it was before today's change.",
    seed: { body: "Old ideas\n\n- A bike rack app\n- Sourdough schedule\n" }, others: [{ body: N_WEEKLY.replace("- Ship v2\n", "- Ship v2\n- Learn Rust\n- Learn Go\n"), folder: "Work", earlier: [N_WEEKLY] }], page: false,
    checks: (f) => {
      const old = f.notes?.find((n) => n.title === "Old ideas");
      return [
        check("restored", !!old && !old.trashed && old.body.includes("Sourdough"), old ? (old.trashed ? "still deleted" : "changed") : "gone"),
        check("weekly_restored", f.others[0].after === N_WEEKLY, f.others[0].after.slice(0, 200)),
      ];
    },
  },
  {
    id: "n-what-about",
    prompt: "What did I write about the dentist?",
    seed: { body: "Health\n\nDentist: Tuesday 14 October at 14:00, Dr. Lind. Bring the X-ray referral.\n", folder: "Health" },
    others: [{ body: N_GROCERIES, folder: "Home" }, { body: N_MEETING, folder: "Work" }, { body: "Calls\n\nCall the dentist to move the cleaning to November.\n" }], page: false,
    checks: (f) => [
      check("found_appointment", /14 Oct|14 October|October 14|Tuesday/i.test(f.answer) && /14[:.]00|2 ?pm/i.test(f.answer), f.answer.slice(0, 200)),
      check("found_the_call", /november|cleaning|move/i.test(f.answer), "missed the second note"),
      check("nothing_changed", f.after === f.before && f.others.every((o) => o.after === o.before), "a note changed"),
    ],
  },
  {
    id: "n-sort-folders",
    prompt: "Sort my loose notes into folders: work things in Work, home things in Home, travel in Travel.",
    seed: { body: N_MEETING }, others: [{ body: N_GROCERIES }, { body: N_TRIP }, { body: "Plumber\n\nThe kitchen tap drips. Call on Friday.\n" }, { body: "Hiring\n\nInterview two designers next week.\n" }, { body: "Packing list\n\n- [ ] Passport\n- [ ] Sunscreen\n" }], page: false,
    checks: (f) => {
      const where = (needle: string) => f.notes?.find((n) => n.body.includes(needle))?.folder ?? "?";
      return [
        check("work", where("Budget review") === "Work" && where("designers") === "Work", `${where("Budget review")}, ${where("designers")}`),
        check("home", where("Bananas") === "Home" && where("tap drips") === "Home", `${where("Bananas")}, ${where("tap drips")}`),
        check("travel", where("Spent in Lisbon") === "Travel" && where("Sunscreen") === "Travel", `${where("Spent in Lisbon")}, ${where("Sunscreen")}`),
        check("nothing_lost", (f.notes ?? []).filter((n) => !n.trashed).length === 6 && (f.notes ?? []).every((n) => !n.trashed), "a note was deleted"),
      ];
    },
  },
  {
    id: "a-workout",
    prompt: "Make my Workouts note a workout tracker app.",
    seed: { body: "Workouts\n" }, page: true, interact: true,
    checks: (f) => [pageChanged(f)],
  },
  {
    id: "a-change-feature",
    prompt: "In my Habits app, add a way to log today: one tap marks today as walked.",
    seed: { body: "Habits\n", page: HABIT_APP, data: { values: { localStorage: { habits: JSON.stringify(HABIT_LOG), theme: "dark" } } } }, page: true, interact: true,
    checks: (f) => [pageChanged(f)],
    walkthrough: [{ name: "log_today", steps: [{ tap: "/walk|today|log|mark/i" }, { wait: 300 }] }],
  },
  {
    id: "a-how-week",
    prompt: "How was my week in my Habits app (29 September to 5 October)? How many days did I walk, and how many did I read?",
    seed: { body: "Habits\n", page: HABIT_APP, data: { values: { localStorage: { habits: JSON.stringify(WEEK_LOG), theme: "dark" } } } }, page: false,
    checks: (f) => [
      check("walk_count", /\b5\b[^.\n]{0,40}walk|walk[^.\n]{0,40}\b5\b|five[^.\n]{0,40}walk|walk[^.\n]{0,40}five/i.test(f.answer), f.answer.slice(0, 200)),
      check("read_count", /\b3\b[^.\n]{0,40}read|read[^.\n]{0,40}\b3\b|three[^.\n]{0,40}read|read[^.\n]{0,40}three/i.test(f.answer), f.answer.slice(0, 200)),
      check("app_unchanged", f.page === f.pageBefore && JSON.stringify(f.data) === JSON.stringify(f.dataBefore), "something changed"),
    ],
  },
  // MARK: The try_app experiment: six real apps, each with a hidden walkthrough and feature list.
  {
    id: "x-lift",
    prompt: `Make my Lift note a Hevy-class strength-training app: the same category and depth of features as Hevy, with your own design and name (no Hevy branding, icons or media).
- Routines: create, reorder, put in folders. Start a workout from a routine or empty.
- Live workout: exercises with sets (weight x reps, optional RPE, warm-up/drop/failure set types), the PREVIOUS values inline on each set, a check to complete a set, an automatic rest timer per exercise, a workout duration clock, supersets, add/replace/reorder exercises mid-workout, and a finish summary (volume, sets, PRs, duration).
- Exercise library: about 100 common exercises with muscle groups and equipment, search and filter, custom exercises.
- History and progress: a calendar of workouts, per-exercise history, charts (best set, volume, estimated 1RM), personal records, the week's distribution across muscle groups.
- Bodyweight measurements. No social feed. Settings: units, rest defaults, a plate calculator.
- Seed realistic demo data: about 9 weeks of push/pull/legs training.`,
    seed: { body: "Lift\n" }, page: true, interact: true, varied: false,
    checks: (f) => [pageChanged(f)],
    walkthrough: [
      { name: "start_workout", steps: [{ tap: "/start|new workout|empty workout|quick start|begin/i" }, { wait: 300 }, { expect: "/exercise|set|reps|kg|lb/i" }] },
      { name: "log_a_set", steps: [{ tap: "/start|new workout|empty workout|quick start|begin/i" }, { tap: "/add exercise|exercises?$|\\+ ?exercise/i" }, { type: "bench", into: "/search/i" }, { tap: "/bench press/i" }, { wait: 300 }, { expect: "/bench press/i" }] },
      { name: "history", steps: [{ tap: "/history|calendar|log|workouts/i" }, { expect: "/(sep|oct|2026)/i" }] },
      { name: "progress", steps: [{ tap: "/progress|stats|records|prs?$|insights/i" }, { expect: "/1rm|record|best|volume|pr/i" }] },
      { name: "library_search", steps: [{ tap: "/exercises|library/i" }, { type: "squat", into: "/search/i" }, { expect: "/squat/i" }] },
      { name: "settings", steps: [{ tap: "/settings|profile|more/i" }, { expect: "/kg|lb|unit/i" }] },
      { name: "desktop", desktop: true, steps: [{ expect: "/history|progress|routines|workout/i" }] },
    ],
    features: [
      { name: "rest_timer", re: /rest/i }, { name: "rpe", re: /\bRPE\b/ }, { name: "set_types", re: /warm.?up/i }, { name: "supersets", re: /superset/i },
      { name: "one_rm", re: /1RM|one.?rep|epley|brzycki/i }, { name: "plate_calculator", re: /plate/i }, { name: "bodyweight", re: /body.?weight/i },
      { name: "muscle_split", re: /muscle/i }, { name: "folders", re: /folder/i }, { name: "big_library", re: /face pull|hip thrust|romanian/i }, { name: "finish_summary", re: /summary/i },
    ],
  },
  {
    id: "x-evening",
    prompt: `Make my Evening note a two-minute evening check-in app (I used to keep this in a spreadsheet).
- Each evening: work hours, four ratings from 1 to 10 (energy, mood, focus, sleep quality), today's habits (only the ones planned for that weekday), a line on what helped or hurt, and tomorrow's one win.
- An overview that opens on tonight (logged or not), today's win, the week's work hours against a weekly budget, how the days felt, and habits done of planned.
- A Sunday week review with a note per week, trends over time (charts of the ratings and hours), and a plan screen for habits per weekday and the weekly hours budget.
- Import rows pasted from the spreadsheet (CSV), and export CSV and JSON.
- Seed six weeks of realistic demo data.`,
    seed: { body: "Evening\n" }, page: true, interact: true,
    checks: (f) => [pageChanged(f)],
    walkthrough: [
      { name: "log_tonight", steps: [{ tap: "/log|check.?in|start|tonight|today/i" }, { wait: 300 }, { expect: "/hours|energy|mood|focus|sleep/i" }] },
      { name: "ratings", steps: [{ tap: "/log|check.?in|start|tonight|today/i" }, { expect: "/mood|energy/i" }] },
      { name: "trends", steps: [{ tap: "/trends|insights|charts|history|stats/i" }, { expect: "/mood|energy|hours|average|avg/i" }] },
      { name: "plan", steps: [{ tap: "/plan|habits|settings/i" }, { expect: "/habit|budget|mon/i" }] },
      { name: "week", steps: [{ tap: "/week|review/i" }, { expect: "/hours|budget|week/i" }] },
      { name: "desktop", desktop: true, steps: [{ expect: "/overview|tonight|week|trends/i" }] },
    ],
    features: [
      { name: "ratings_1_10", re: /energy/i }, { name: "habits_by_weekday", re: /weekday|mon(day)?.*tue/i }, { name: "hours_budget", re: /budget/i },
      { name: "csv_import", re: /csv|paste/i }, { name: "json_export", re: /JSON\.stringify[\s\S]{0,200}(download|share|blob|export)|export/i }, { name: "charts", re: /recharts|<svg|LineChart|BarChart/ }, { name: "tomorrow", re: /tomorrow/i },
    ],
  },
  {
    id: "x-budget",
    prompt: `Make my Budget note a personal budget app.
- Monthly budgets per category, and expenses with amount, category, date and a note. Add, edit and delete expenses quickly from the phone.
- A month view: spent against budget overall and per category, what's left per day, and a chart of spending by category. Move between months.
- Recurring expenses (rent, subscriptions) that fill in each month.
- Search and filter expenses; export CSV.
- Settings: currency, the month's start day, categories (add, rename, colour).
- Seed three months of realistic demo data.`,
    seed: { body: "Budget\n" }, page: true, interact: true,
    checks: (f) => [pageChanged(f)],
    walkthrough: [
      { name: "add_expense", steps: [{ tap: "/^\\+$|^(add|new)\\b|add expense|new expense|log expense/i" }, { type: "42", into: "/amount|sum|price/i" }, { type: "Coffee beans", into: "/note|description|what|item|name|title|merchant|payee/i" }, { tap: "/^(save|add|done|create)\\b|save expense|add expense/i" }, { wait: 300 }, { tap: "/^(expenses|transactions|history|all)$/i", optional: true }, { expect: "Coffee beans" }] },
      { name: "month_view", steps: [{ expect: "/left|remaining|budget|spent/i" }] },
      { name: "previous_month", steps: [{ tap: "/previous|prev|‹|←|back|last month/i" }, { expect: "/(jul|aug|sep)/i" }] },
      { name: "search", steps: [{ tap: "/expenses|transactions|history|search/i" }, { type: "rent", into: "/search|filter/i" }, { expect: "/rent/i" }] },
      { name: "settings", steps: [{ tap: "/settings|categories|more/i" }, { expect: "/currency|categor/i" }] },
      { name: "desktop", desktop: true, steps: [{ expect: "/spent|budget|left|remaining/i" }] },
    ],
    features: [
      { name: "recurring", re: /recurring|subscription/i }, { name: "per_day", re: /per day|\/ ?day|daily/i }, { name: "chart", re: /recharts|<svg|PieChart|BarChart/ },
      { name: "csv_export", re: /csv/i }, { name: "currency", re: /currency/i }, { name: "month_start", re: /start.?day|month.?start|startDay/i }, { name: "edit_delete", re: /delete|remove/i },
    ],
  },
  {
    id: "x-game",
    prompt: `Make my Games note a polished 2048 game.
- Swipe on the phone, arrow keys on the Mac; smooth tile slides and merges.
- Score and best score (kept), undo the last move, and a new game button.
- A win screen at 2048 with "keep going", and a game-over screen.
- A small stats screen: games played, best tile, average score.`,
    seed: { body: "Games\n" }, page: true, interact: true, plays: true,
    checks: (f) => [pageChanged(f)],
    walkthrough: [
      { name: "shows_score", steps: [{ expect: "/score/i" }] },
      { name: "moves", steps: [{ press: "ArrowLeft" }, { press: "ArrowUp" }, { press: "ArrowRight" }, { press: "ArrowDown" }, { expect: "/score/i" }] },
      { name: "new_game", steps: [{ press: "ArrowLeft" }, { tap: "/new game|restart|new/i" }, { expect: "/score/i" }] },
      { name: "undo", steps: [{ press: "ArrowLeft" }, { tap: "/undo/i" }, { expect: "/score/i" }] },
      { name: "stats", steps: [{ tap: "/stats|statistics/i" }, { expect: "/played|best|average/i" }] },
      { name: "desktop", desktop: true, steps: [{ press: "ArrowLeft" }, { expect: "/score/i" }] },
    ],
    features: [
      { name: "keyboard", re: /ArrowLeft/ }, { name: "touch", re: /touchstart|pointerdown|onTouchStart|onPointerDown/ }, { name: "undo", re: /undo/i }, { name: "best", re: /best/i },
      { name: "win_2048", re: /2048/ }, { name: "keep_going", re: /keep going|continue/i }, { name: "game_over", re: /game over/i }, { name: "stats", re: /played/i },
    ],
  },
  {
    id: "x-kanban",
    prompt: `Make my Projects note a kanban board app.
- Several boards, each with columns (default To do, Doing, Done) that can be added, renamed and reordered.
- Cards with a title, description, due date, labels and a checklist. Add a card fast; open it to edit details.
- Move cards between columns (drag on the Mac, and a "move to" action on the phone) and reorder within a column.
- Search, filter by label, show overdue cards, and archive done cards.
- Seed two boards of realistic demo cards.`,
    seed: { body: "Projects\n" }, page: true, interact: true,
    checks: (f) => [pageChanged(f)],
    walkthrough: [
      { name: "columns", steps: [{ expect: "/to ?do/i" }, { expect: "/doing|in progress/i" }, { expect: "/done/i" }] },
      { name: "add_card", steps: [{ tap: "/add( a)? card|new card|add task|\\+/i" }, { type: "Write the quarterly report", into: "/title|card|task|name/i" }, { press: "Enter" }, { wait: 300 }, { tap: "/^(add|save|create|done)( card)?$/i", optional: true }, { expect: "Write the quarterly report" }] },
      { name: "open_card", steps: [{ tap: "/./" }, { expect: "/description|due|label|checklist/i" }] },
      { name: "search", steps: [{ type: "a", into: "/search|filter/i" }, { expect: "/./" }] },
      { name: "boards", steps: [{ tap: "/boards?/i" }, { expect: "/board/i" }] },
      { name: "desktop", desktop: true, steps: [{ expect: "/to ?do/i" }, { expect: "/done/i" }] },
    ],
    features: [
      { name: "drag", re: /drag/i }, { name: "move_to", re: /move to/i }, { name: "labels", re: /label/i }, { name: "due_dates", re: /due/i }, { name: "checklist", re: /checklist/i },
      { name: "overdue", re: /overdue/i }, { name: "archive", re: /archive/i }, { name: "multiple_boards", re: /boards/i }, { name: "reorder_columns", re: /reorder|move (left|right)|rename/i },
    ],
  },
  {
    id: "x-recipes",
    prompt: `Make my Recipes note a recipe and meal planning app.
- A recipe library: ingredients (amount, unit), steps, servings, time and tags. Add and edit recipes; scale a recipe to a number of servings.
- A weekly meal plan: put recipes on days (breakfast, lunch, dinner).
- A shopping list made from the week's plan: ingredients added up across recipes, grouped by aisle, checkable, plus your own items.
- Search recipes and filter by tag; a cooking mode that shows one step at a time with the screen kept large and readable.
- Seed twelve realistic recipes and this week's plan.`,
    seed: { body: "Recipes\n" }, page: true, interact: true,
    checks: (f) => [pageChanged(f)],
    walkthrough: [
      { name: "library", steps: [{ tap: "/recipes|library/i" }, { expect: "/min|serv/i" }] },
      { name: "search", steps: [{ tap: "/recipes|library/i" }, { type: "zzqx", into: "/search/i" }, { expect: "/no (recipes|results|match)|nothing|0 recipes/i" }] },
      { name: "plan", steps: [{ tap: "/plan|week|meal/i" }, { expect: "/mon|tue|monday/i" }] },
      { name: "shopping", steps: [{ tap: "/shopping|groceries|list/i" }, { expect: "/\\d/" }] },
      { name: "open_recipe", steps: [{ tap: "/recipes|library/i" }, { type: "a", into: "/search/i" }, { press: "Enter" }, { expect: "/./" }] },
      { name: "desktop", desktop: true, steps: [{ expect: "/recipes|plan|shopping/i" }] },
    ],
    features: [
      { name: "scaling", re: /servings/i }, { name: "units", re: /\b(g|ml|tbsp|tsp)\b/ }, { name: "meal_slots", re: /breakfast/i }, { name: "aggregated_list", re: /aisle/i },
      { name: "own_items", re: /custom|own item|add item/i }, { name: "tags", re: /tag/i }, { name: "cooking_mode", re: /cook(ing)? mode|step \{|next step|Step /i }, { name: "twelve_recipes", re: /(title|name)[\s\S]{0,4000}(title|name)/ },
    ],
  },
  {
    // The person's AI changes an app's data behind the scenes: the app stays as it is.
    id: "habit-data-remove-dates",
    prompt: "In my Habits app, remove the entries for 3, 4 and 5 October. They were logged by mistake.",
    seed: { body: "Habits\n", page: HABIT_APP, data: { values: { localStorage: { habits: JSON.stringify(HABIT_LOG), theme: "dark" } } } }, page: false,
    checks: (f) => {
      const ls = (f.data as { values?: { localStorage?: Record<string, unknown> } })?.values?.localStorage ?? {};
      const raw = ls.habits;
      let rows: { date: string }[] = [];
      try { rows = typeof raw === "string" ? JSON.parse(raw) : []; } catch { /* checked below */ }
      const dates = rows.map((r) => r.date);
      return [
        check("app_unchanged", f.page === f.pageBefore, "the app was changed"),
        check("still_a_string", typeof raw === "string", "localStorage.habits isn't the JSON string the app reads any more"),
        check("dates_removed", !dates.some((d) => d >= "2026-10-03" && d <= "2026-10-05"), `left: ${dates.filter((d) => d >= "2026-10-03" && d <= "2026-10-05").join(", ")}`),
        check("others_kept", dates.length === HABIT_LOG.length - 3 && HABIT_LOG.filter((h) => h.date < "2026-10-03" || h.date > "2026-10-05").every((h) => dates.includes(h.date)), `${dates.length} entries left`),
        check("settings_kept", ls.theme === "dark", "another localStorage key was lost"),
      ];
    },
  },
  {
    id: "budget-data-rename-category",
    prompt: "In my Budget app, rename the category Food to Groceries everywhere.",
    seed: { body: "Budget\n", page: BUDGET_APP, data: { values: { settings: { categories: ["Food", "Home", "Fun"], limit: 12000 } }, collections: { expenses: BUDGET_EXPENSES } } }, page: false,
    checks: (f) => {
      const d = f.data as { values?: { settings?: { categories?: string[]; limit?: number } }; collections?: { expenses?: { id: string; category: string; amount: number }[] } };
      const ex = d?.collections?.expenses ?? [];
      return [
        check("app_unchanged", f.page === f.pageBefore, "the app was changed"),
        check("records_renamed", ex.length === BUDGET_EXPENSES.length && !ex.some((e) => e.category === "Food") && ex.filter((e) => e.category === "Groceries").length === BUDGET_EXPENSES.filter((e) => e.category === "Food").length, `${ex.filter((e) => e.category === "Food").length} still Food`),
        check("ids_kept", BUDGET_EXPENSES.every((b) => ex.some((e) => e.id === b.id && e.amount === b.amount)), "records lost their ids or amounts"),
        check("setting_renamed", JSON.stringify(d?.values?.settings?.categories) === JSON.stringify(["Groceries", "Home", "Fun"]), `categories: ${JSON.stringify(d?.values?.settings?.categories)}`),
        check("limit_kept", d?.values?.settings?.limit === 12000, "the limit changed"),
      ];
    },
  },
  {
    // The baseline comparison (baseline.ts): the same bare request Claude Code and Codex get in an
    // empty folder. The person is in an empty note called Workouts.
    id: "workout-tracker-open",
    prompt: "build me a workout tracker app",
    seed: { body: "Workouts\n" }, page: true, interact: true,
    checks: (f) => [pageChanged(f)],
  },
  {
    // The same, with a log to show: both sides get it in the request.
    id: "workout-tracker-data",
    prompt: `build me a workout tracker app. Here's what I've done the last two weeks:
${["2026-09-22 squat 80kg 5x5, bench 55kg 5x5", "2026-09-24 deadlift 100kg 1x5, press 35kg 5x5, 5 km run 28 min", "2026-09-26 squat 82.5kg 5x5, bench 57.5kg 5,5,5,4,4",
  "2026-09-29 squat 85kg 5x5, bench 57.5kg 5x5, row 50kg 3x8", "2026-10-01 deadlift 105kg 1x5, press 37.5kg 5,5,4,4,3, 6 km run 33 min", "2026-10-03 squat 87.5kg 5x5, bench 60kg 5,5,5,5,3"].join("\n")}`,
    seed: { body: "Workouts\n" }, page: true, interact: true,
    checks: (f) => [pageChanged(f), check("has_log", /87\.?5/.test(f.after + JSON.stringify(f.data ?? {})), "the log isn't in the note or the app's data")],
  },
  {
    id: "training-app-focus",
    prompt: "Make my Training note an app I can use at the gym. I want to see what to do today, tick off sets, adjust the plan, and see my progress over time.",
    seed: { body: `Training

Plan (3 days a week)
- Mon: squat 3x5, bench 3x5, row 3x8
- Wed: deadlift 1x5, press 3x5, pull-ups 3x max
- Fri: squat 3x5, bench 3x5, chin-ups 3x max

| Date | Exercise | Weight | Reps |
| --- | --- | --- | --- |
| 2026-09-28 | Squat | 80 | 5,5,5 |
| 2026-09-28 | Bench | 55 | 5,5,4 |
| 2026-09-30 | Deadlift | 100 | 5 |
| 2026-10-02 | Squat | 82.5 | 5,5,5 |
| 2026-10-02 | Bench | 55 | 5,5,5 |
` }, page: true, varied: true, interact: true,
    checks: (f) => {
      const first = f.render?.views.find((v) => v.width < 600 && v.scheme === "light");
      return [
        rowsKept(f.before, f.after),
        check("opens_on_today", /today|monday|mon\b/i.test(first?.excerpt ?? "") , `first screen starts: ${(first?.excerpt ?? "").slice(0, 80)}`),
        check("has_navigation", !!first?.nav || /role=["']tab|<nav\b|tablist/.test(f.page ?? ""), "no tabs or navigation between today, plan and progress"),
      ];
    },
  },
];

export const byId = (id: string) => TASKS.find((t) => t.id === id);
