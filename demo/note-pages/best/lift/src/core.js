// Data and helpers. The app's own data holds the routines, the library's custom exercises, every
// finished workout in full and the one in progress; each finished workout is also written into the
// note's Log table as one readable row per exercise.
const html = htm.bind(preact.h);
const { useState, useLayoutEffect, useRef, useMemo } = preactHooks;
const { Router, route, back, useRoute } = amberRouter;

const esc = (s) => String(s ?? "");
const V = () => amber.data.values || {};
const C = (n) => (amber.data.collections && amber.data.collections[n]) || [];
const DEFAULTS = { unit: "kg", rest: 120, restWarmup: 60, showRpe: true, notify: true, bar: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] };
const S = () => ({ ...DEFAULTS, ...(V().settings || {}) });
const saveSettings = (p) => amber.setData({ values: { settings: p } });
const uid = () => Math.random().toString(36).slice(2, 9);

// Exercises: the built-ins, plus the person's own.
const allExercises = () => [...LIB, ...((V().custom || []).map((x) => ({ ...x, custom: true })))];
const exById = (id) => allExercises().find((x) => x.id === id) || { id, name: id, muscle: "Other", other: [], equipment: "Other" };
const MCOLOR = { Chest: "--c-red", Back: "--c-blue", Shoulders: "--c-violet", Biceps: "--c-teal", Triceps: "--c-pink", Forearms: "--c-olive", Abs: "--c-amber", Quads: "--c-green", Hamstrings: "--c-brown", Glutes: "--c-rose", Calves: "--c-sky", "Full body": "--c-amber", Cardio: "--c-sky", Other: "--c-brown" };

// Weights are kept in kg; shown in the unit chosen in Settings.
const toUnit = (kg) => (S().unit === "lb" ? Math.round(kg * 2.20462 * 2) / 2 : Math.round(kg * 100) / 100);
const fromUnit = (v) => (S().unit === "lb" ? v / 2.20462 : v);
const fmtW = (kg) => { const v = toUnit(kg); return (Number.isInteger(v) ? String(v) : String(v).replace(".", ",")); };
const unit = () => S().unit;
const parseNum = (s) => { const n = parseFloat(String(s ?? "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
const e1rm = (kg, reps) => (reps <= 0 ? 0 : reps === 1 ? kg : kg * (1 + reps / 30));
const working = (sets) => sets.filter((s) => s.done && s.type !== "warmup");
const volume = (w) => w.exercises.reduce((a, e) => a + working(e.sets).reduce((b, s) => b + (s.kg || 0) * (s.reps || 0), 0), 0);
const fmtVol = (kg) => { const v = toUnit(kg); return v >= 10000 ? `${(v / 1000).toFixed(1).replace(".", ",")} t` : `${Math.round(v).toLocaleString("sv-SE")} ${unit()}`; };
const fmtDur = (min) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`);

// Dates: the note's "today", days as yyyy-mm-dd.
const day = (iso) => iso.slice(0, 10);
const D = {
  parse: (s) => new Date(s.slice(0, 10) + "T12:00:00Z"),
  iso: (d) => d.toISOString().slice(0, 10),
  add: (s, n) => { const d = D.parse(s); d.setUTCDate(d.getUTCDate() + n); return D.iso(d); },
  diff: (a, b) => Math.round((D.parse(a) - D.parse(b)) / 864e5),
  wd: (s) => (D.parse(s).getUTCDay() + 6) % 7,
  fmt: (s, o = { weekday: "short", day: "numeric", month: "short" }) => D.parse(s).toLocaleDateString("en-GB", { timeZone: "UTC", ...o }),
};
const rel = (s, today) => { const n = D.diff(today, s); return n === 0 ? "Today" : n === 1 ? "Yesterday" : n < 7 ? D.fmt(s, { weekday: "long" }) : D.fmt(s, { day: "numeric", month: "short" }); };

// Finished workouts, newest first.
const workouts = () => C("workouts").slice().sort((a, b) => (b.start || "").localeCompare(a.start || ""));

// What this exercise was last time: the sets of the most recent workout that had it.
function previous(exId, beforeIso) {
  for (const w of workouts()) {
    if (beforeIso && w.start >= beforeIso) continue;
    const e = w.exercises.find((x) => x.ex === exId);
    if (e) return e.sets.filter((s) => s.done);
  }
  return [];
}
// Records from every finished workout: heaviest weight, best estimated 1RM, best set volume, most reps.
function records(exId, beforeIso) {
  const r = { weight: 0, e1rm: 0, setVol: 0, reps: 0, sessions: [] };
  for (const w of workouts().slice().reverse()) {
    if (beforeIso && w.start >= beforeIso) continue;
    const e = w.exercises.find((x) => x.ex === exId); if (!e) continue;
    const ws = working(e.sets); if (!ws.length) continue;
    const best = { date: day(w.start), weight: 0, e1rm: 0, vol: 0, reps: 0, top: null, wid: w.id };
    for (const s of ws) {
      const v = (s.kg || 0) * (s.reps || 0), one = e1rm(s.kg || 0, s.reps || 0);
      if ((s.kg || 0) > best.weight) { best.weight = s.kg || 0; best.top = s; }
      best.e1rm = Math.max(best.e1rm, one); best.vol += v; best.reps = Math.max(best.reps, s.reps || 0);
      r.weight = Math.max(r.weight, s.kg || 0); r.e1rm = Math.max(r.e1rm, one); r.setVol = Math.max(r.setVol, v); r.reps = Math.max(r.reps, s.reps || 0);
    }
    r.sessions.push(best);
  }
  return r;
}
// The PRs a workout set: compared with everything before it.
function prsOf(w) {
  const out = [];
  for (const e of w.exercises) {
    const before = records(e.ex, w.start), ws = working(e.sets);
    if (!ws.length || !before.sessions.length) continue;
    const top = Math.max(...ws.map((s) => s.kg || 0)), one = Math.max(...ws.map((s) => e1rm(s.kg || 0, s.reps || 0)));
    if (top > before.weight + 1e-6) out.push({ ex: e.ex, kind: "Heaviest weight", value: `${fmtW(top)} ${unit()}` });
    else if (one > before.e1rm + 0.5) out.push({ ex: e.ex, kind: "Best est. 1RM", value: `${Math.round(toUnit(one))} ${unit()}` });
  }
  return out;
}

// The note's log: the table under "Log" with Date, Workout, Exercise and Sets.
function logTable(note) {
  return note.tables.find((t) => ["date", "workout", "exercise", "sets"].every((n) => t.columns.some((c) => c.name.trim().toLowerCase() === n)));
}
const setText = (s, ex) => `${s.type === "warmup" ? "W " : s.type === "drop" ? "D " : s.type === "failure" ? "F " : ""}${s.kg ? `${fmtW(s.kg)}×` : ""}${s.reps || 0}${ex.equipment === "Bodyweight" && /plank/i.test(ex.name) ? "s" : ""}${s.rpe ? ` @${s.rpe}` : ""}`;
function logOps(note, w) {
  const t = logTable(note); if (!t) return null;
  return w.exercises.filter((e) => e.sets.some((s) => s.done)).map((e) => ({ op: "append_row", table: t.index, values: { Date: day(w.start), Workout: w.name, Exercise: exById(e.ex).name, Sets: e.sets.filter((s) => s.done).map((s) => setText(s, exById(e.ex))).join(" · ") } }));
}

// Icons: lines on a 24 grid.
const P = {
  dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2"/>',
  library: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="16" rx="1"/><path d="M17 5l3 .5-2 14.5-3-.5z"/>',
  chart: '<path d="M4 20V11M10 20V5M16 20v-6M21 20H3"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>', chev: '<path d="M9 5l7 7-7 7"/>', down: '<path d="M6 9l6 6 6-6"/>', up: '<path d="M6 15l6-6 6 6"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', play: '<path d="M7 4.5v15l12.5-7.5z"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2h5"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  swap: '<path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>', link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  scale: '<path d="M4 20h16l-2-12H6zM9 8a3 3 0 0 1 6 0"/>', note: '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>', bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
};
const I = (n, cls = "i") => html`<svg class=${cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: P[n] || "" }}></svg>`;

// Equipment glyphs, drawn for this app: the tool, not the body.
const G = {
  Barbell: '<path d="M2 12h20"/><rect x="5" y="7" width="2.5" height="10" rx=".6"/><rect x="16.5" y="7" width="2.5" height="10" rx=".6"/><rect x="3" y="9" width="2" height="6" rx=".5"/><rect x="19" y="9" width="2" height="6" rx=".5"/>',
  Dumbbell: '<path d="M8 12h8"/><rect x="4" y="8" width="4" height="8" rx="1.2"/><rect x="16" y="8" width="4" height="8" rx="1.2"/>',
  Machine: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 10h6M9 13h6M12 16v3"/>',
  Cable: '<path d="M6 3v18M6 4l11 7"/><circle cx="17" cy="12" r="1.6"/><path d="M17 13.5V18M15 18h4"/>',
  Bodyweight: '<circle cx="12" cy="5" r="2"/><path d="M12 7v7M7 10l5-1 5 1M9 21l3-7 3 7"/>',
  Kettlebell: '<path d="M9 7a3 3 0 0 1 6 0"/><path d="M7.5 9.5A6 6 0 1 0 16.5 9.5z"/>',
  Band: '<path d="M4 16c3-8 13-8 16 0"/><path d="M4 16h3M17 16h3"/>',
  Other: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/>',
};
const Glyph = ({ ex, sm }) => { const e = typeof ex === "string" ? exById(ex) : ex; return html`<span class=${"glyph" + (sm ? " sm" : "")} style=${`--mc:var(${MCOLOR[e.muscle] || "--c-brown"})`} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" dangerouslySetInnerHTML=${{ __html: G[e.equipment] || G.Other }}></svg></span>`; };

// One sheet at a time, closed by the scrim, Escape or its own button.
let setSheet = () => {};
function SheetHost() {
  const [s, set] = useState(null);
  setSheet = set;
  useLayoutEffect(() => { const k = (e) => { if (e.key === "Escape") set(null); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, []);
  useLayoutEffect(() => { document.documentElement.style.overflow = s ? "hidden" : ""; }, [s]);
  if (!s) return null;
  return html`<div class="scrim" onClick=${() => set(null)}></div>
    <section class=${"sheet" + (s.wide ? " wide" : "")} role="dialog" aria-modal="true" aria-label=${s.title}>
      <header><h2>${s.title}</h2><button class="round" onClick=${() => set(null)} aria-label="Close">${I("close")}</button></header>
      <div class="body">${s.body()}</div>${s.foot ? html`<div class="foot">${s.foot()}</div>` : null}</section>`;
}
const openSheet = (o) => setSheet(o);
const closeSheet = () => setSheet(null);

// A line or bar chart drawn to its real width.
function Chart({ points, bars, fmt = (v) => v, height = 180 }) {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => { const el = ref.current; if (!el) return; const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth); return () => ro.disconnect(); }, []);
  const W = Math.max(240, w), H = height, L = 34, R = 8, T = 10, B = 20;
  if (!points || points.length < 1) return html`<div ref=${ref} class="muted small">Not enough to chart yet.</div>`;
  const vs = points.map((p) => p.v), lo0 = Math.min(...vs), hi0 = Math.max(...vs);
  const span = hi0 - lo0 || hi0 || 1, lo = bars ? 0 : Math.max(0, lo0 - span * .15), hi = hi0 + span * .1;
  const x = (i) => L + (points.length === 1 ? (W - L - R) / 2 : (i / (points.length - 1)) * (W - L - R)), y = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  const ticks = [lo, (lo + hi) / 2, hi];
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const bw = Math.max(4, Math.min(28, (W - L - R) / points.length * .6));
  return html`<div ref=${ref}><svg viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${`Chart from ${fmt(points[0].v)} to ${fmt(points[points.length - 1].v)}`}>
    ${ticks.map((v) => html`<line class="gl" x1=${L} x2=${W - R} y1=${y(v)} y2=${y(v)} /><text class="ax" x="0" y=${y(v) + 3}>${fmt(v)}</text>`)}
    ${bars ? points.map((p, i) => html`<rect class=${"bar" + (p.dim ? " dim" : "")} x=${x(i) - bw / 2} y=${y(p.v)} width=${bw} height=${Math.max(1, y(lo) - y(p.v))} rx="3" />`)
      : html`<path class="ar" d=${`${path} L ${x(points.length - 1)} ${H - B} L ${x(0)} ${H - B} Z`} /><path class="ln" d=${path} />${points.map((p, i) => html`<circle class="pt" cx=${x(i)} cy=${y(p.v)} r="3" />`)}`}
    <text class="ax" x=${L} y=${H - 4}>${points[0].label}</text><text class="ax" x=${W - R} y=${H - 4} text-anchor="end">${points[points.length - 1].label}</text></svg></div>`;
}
