// Evening's data is JSON in the app's own store, so an AI reading it sees the same columns as the
// spreadsheet it replaced:
//   days (a collection), one record per evening:
//     { date: "2026-10-05", workHours, goodWorkHours, energy, mood, focus, sleep,   (ratings 1-10)
//       habits: { diet: "Yes" | "No" | "N/A", ... },                              (by habit id)
//       helped, hurt, notes,
//       tomorrow: { win, outcomes: ["", "", ""], firstTask, alarmsSet },
//       loggedAt }                                                                 (set on Finish)
//   weeks (a collection): { start: "2026-10-05" (a Monday), target, note }
//   settings: the plan (hours per weekday, habits and their days, review date, reminder)
import { useCollection, useSettings } from "@/lib/amber";

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEK = [1, 2, 3, 4, 5, 6, 0]; // Monday first
export const RATINGS = [["energy", "Energy"], ["mood", "Mood"], ["focus", "Focus / output"], ["sleep", "Sleep quality"]];
const ALL = [0, 1, 2, 3, 4, 5, 6];

// A starting plan; the person's own comes from Plan, or from their spreadsheet through the import.
export const PLAN = {
  hours: [0, 8, 8, 8, 8, 8, 0], // Sunday to Saturday: 40 h a week
  habits: [
    { id: "exercise", name: "Exercise", days: [1, 3, 5], detail: "30 min" },
    { id: "walk", name: "Walk", days: ALL, detail: "20 min outside" },
    { id: "reading", name: "Reading", days: ALL, detail: "A few pages" },
    { id: "plan", name: "Plan tomorrow", days: [0, 1, 2, 3, 4], detail: "Before closing the laptop" },
  ],
  reviewDate: "",
  remind: true,
  remindAt: "21:30",
};
export const usePlan = () => useSettings(PLAN);

// Dates are local calendar days, "YYYY-MM-DD".
export const iso = (d) => d.toLocaleDateString("sv-SE");
export const parse = (s) => new Date(s + "T12:00:00");
// The evening runs past midnight: until 4 in the morning it is still the day before.
export const today = () => iso(new Date(Date.now() - 4 * 3600e3));
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
export const weekday = (s) => parse(s).getDay();
export const weekStart = (s) => addDays(s, -((weekday(s) + 6) % 7));
export const weekDates = (start) => Array.from({ length: 7 }, (_, i) => addDays(start, i));
export const weekNumber = (s) => { const d = parse(s); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); const y = new Date(d.getFullYear(), 0, 4); return 1 + Math.round(((d - y) / 864e5 - 3 + ((y.getDay() + 6) % 7)) / 7); };
export const longDate = (s) => parse(s).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
export const shortDate = (s) => parse(s).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export const hoursFor = (plan, s) => plan.hours[weekday(s)] ?? 0;
export const weekBudget = (plan) => plan.hours.reduce((a, b) => a + b, 0);
export const scheduled = (habit, s) => habit.days.includes(weekday(s));
export const fmtH = (h) => (h == null ? "–" : `${Math.round(h * 10) / 10}`);
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const avg = (xs) => { const v = xs.filter((x) => typeof x === "number"); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; };

/** Days and weeks, with lookups. */
export function useEvenings() {
  const days = useCollection("days"), weeks = useCollection("weeks");
  const byDate = {};
  for (const d of days.items) byDate[d.date] = d;
  const save = async (date, patch) => {
    const found = byDate[date];
    if (found) await days.update(found.id, patch);
    else await days.add({ date, ...patch });
  };
  const weekOf = (start) => weeks.items.find((w) => w.start === start);
  const saveWeek = async (start, patch) => {
    const w = weekOf(start);
    if (w) await weeks.update(w.id, patch);
    else await weeks.add({ start, ...patch });
  };
  return { days, weeks, byDate, save, weekOf, saveWeek };
}

export const logged = (d) => !!(d && d.loggedAt);

/** Evenings logged in a row, ending tonight (or last night, when tonight isn't logged yet). */
export function streak(byDate, from = today()) {
  let s = logged(byDate[from]) ? from : addDays(from, -1), n = 0;
  while (logged(byDate[s])) { n++; s = addDays(s, -1); }
  return n;
}

/** The Weekly Review sheet's row for one week. */
export function weekStats(ev, plan, start) {
  const dates = weekDates(start), recs = dates.map((d) => ev.byDate[d]).filter(logged);
  const hours = recs.reduce((a, d) => a + (+d.workHours || 0), 0), good = recs.reduce((a, d) => a + (+d.goodWorkHours || 0), 0);
  const target = ev.weekOf(start)?.target ?? weekBudget(plan);
  const habits = plan.habits.map((h) => {
    const due = dates.filter((d) => scheduled(h, d));
    return { ...h, done: due.filter((d) => ev.byDate[d]?.habits?.[h.id] === "Yes").length, due: due.length, marks: dates.map((d) => (scheduled(h, d) ? ev.byDate[d]?.habits?.[h.id] || "" : "off")) };
  });
  const averages = Object.fromEntries(RATINGS.map(([k]) => [k, avg(recs.map((d) => d[k]))]));
  return { start, dates, recs, hours, good, goodPct: pct(good, hours), target, habits, averages, note: ev.weekOf(start)?.note || "" };
}

/** A habit's current and best run, counting only the days it was scheduled. */
export function habitRuns(ev, habit, until = today()) {
  const dates = Object.keys(ev.byDate).filter((d) => logged(ev.byDate[d])).sort();
  if (!dates.length) return { current: 0, best: 0 };
  let best = 0, run = 0;
  for (let s = dates[0]; s <= until; s = addDays(s, 1)) {
    if (!scheduled(habit, s)) continue;
    const v = ev.byDate[s]?.habits?.[habit.id];
    if (v === "Yes") { run++; best = Math.max(best, run); } else if (s < until || v === "No") run = 0;
  }
  return { current: run, best };
}

/** "What helped" and "What hurt" grouped: the same phrase written on different days counts once each day. */
export function themes(recs, key) {
  const counts = new Map();
  for (const d of recs) {
    const seen = new Set();
    for (const raw of String(d[key] || "").split(/[,;.\n]| and | \+ /i)) {
      const p = raw.trim().replace(/^(a |the )/i, "").toLowerCase();
      if (p.length < 3 || seen.has(p)) continue;
      seen.add(p);
      const c = counts.get(p) || { text: raw.trim(), n: 0, dates: [] };
      c.n++; c.dates.push(d.date); counts.set(p, c);
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || b.dates.at(-1).localeCompare(a.dates.at(-1)));
}

// The spreadsheet's columns, for import and export.
export const SHEET = ["Date", "Day", "Week start", "Work hours", "Good work hours", "Energy (1-10)", "Mood (1-10)", "Focus / output (1-10)", "Sleep quality (1-10)"];
const SHEET_TAIL = ["What helped today?", "What hurt today?", "Notes", "Win condition", "Outcomes", "First task", "Alarms set"];

export function toCSV(plan, recs) {
  const head = [...SHEET, ...plan.habits.map((h) => h.name), ...SHEET_TAIL];
  const q = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = recs.map((d) => [d.date, DAY_NAMES[weekday(d.date)], weekStart(d.date), d.workHours, d.goodWorkHours, d.energy, d.mood, d.focus, d.sleep,
    ...plan.habits.map((h) => d.habits?.[h.id] || (scheduled(h, d.date) ? "" : "N/A")), d.helped, d.hurt, d.notes,
    d.tomorrow?.win, (d.tomorrow?.outcomes || []).filter(Boolean).join(" · "), d.tomorrow?.firstTask, d.tomorrow ? (d.tomorrow.alarmsSet ? "Yes" : "No") : ""]);
  return [head, ...rows].map((r) => r.map(q).join(",")).join("\n");
}

function parseCSV(text) {
  const rows = [[]]; let f = "", q = false;
  const sep = (text.split("\n")[0].match(/\t/g) || []).length > (text.split("\n")[0].match(/,/g) || []).length ? "\t" : ",";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true;
    else if (c === sep) { rows.at(-1).push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; rows.at(-1).push(f); f = ""; rows.push([]); }
    else f += c;
  }
  rows.at(-1).push(f);
  return rows.filter((r) => r.some((x) => x.trim()));
}

/**
 * Rows from the spreadsheet (a CSV or tab-separated copy of Daily Tracker), as day records.
 * Only rows with something filled in come in; habits the plan doesn't have yet are added to it.
 */
export function fromSheet(text, plan) {
  const [head, ...rows] = parseCSV(text);
  if (!head) return { days: [], habits: plan.habits };
  const col = (name) => head.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  const num = (v) => { const n = parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) ? n : null; };
  // A plan nobody has changed yet gives way to the spreadsheet's own habits.
  const untouched = JSON.stringify(plan.habits) === JSON.stringify(PLAN.habits);
  const habits = untouched ? [] : plan.habits.map((h) => ({ ...h }));
  const start = col("Sleep quality (1-10)") + 1, end = col("What helped today?");
  const habitCols = head.slice(start, end > start ? end : start).map((name, i) => {
    const id = habits.find((h) => h.name.toLowerCase() === name.trim().toLowerCase())?.id || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (!habits.some((h) => h.id === id)) habits.push({ id, name: name.trim(), days: [0, 1, 2, 3, 4, 5, 6], detail: "" });
    return [start + i, id];
  });
  if (!habits.length) habits.push(...plan.habits.map((h) => ({ ...h })));
  const date = (v) => { const s = String(v).trim(); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); const n = +s; if (n > 30000) return iso(new Date(Date.UTC(1899, 11, 30) + n * 864e5)); const d = new Date(s); return isNaN(d) ? null : iso(d); };
  const days = [];
  for (const r of rows) {
    const d = date(r[col("Date")]); if (!d) continue;
    const get = (name) => { const i = col(name); return i < 0 ? "" : (r[i] || "").trim(); };
    const rec = { date: d, workHours: num(get("Work hours")), goodWorkHours: num(get("Good work hours")), energy: num(get("Energy (1-10)")), mood: num(get("Mood (1-10)")),
      focus: num(get("Focus / output (1-10)")), sleep: num(get("Sleep quality (1-10)")), habits: {}, helped: get("What helped today?"), hurt: get("What hurt today?"), notes: get("Notes") };
    for (const [i, id] of habitCols) { const v = (r[i] || "").trim(); if (/^(yes|no|n\/a)$/i.test(v)) rec.habits[id] = v.toUpperCase() === "N/A" ? "N/A" : v[0].toUpperCase() + v.slice(1).toLowerCase(); }
    const filled = rec.workHours != null || RATINGS.some(([k]) => rec[k] != null) || Object.values(rec.habits).some((v) => v !== "N/A") || rec.helped || rec.hurt || rec.notes;
    if (filled) days.push({ ...rec, loggedAt: d + "T21:30:00", imported: true });
  }
  return { days, habits };
}
