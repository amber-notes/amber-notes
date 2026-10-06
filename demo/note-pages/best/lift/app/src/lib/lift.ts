// Lift's data is JSON in the app's own store (encrypted, synced, with Undo):
//   values.routines  [{ id, name, folder, exercises: [{ ex, rest, superset, sets: [{ type, reps }] }] }]
//   values.folders   ["Push Pull Legs", ...]
//   values.custom    the person's own exercises, next to the built-in library
//   values.active    the workout in progress, set by set (it survives closing the note)
//   values.settings  units, rest times, RPE, the bar and plates
//   collections.workouts    every finished workout in full: { id, routine, name, start, minutes, exercises }
//   collections.bodyweight  { date, kg }
// Weights are kept in kg and shown in the unit chosen in Settings.
import { amber } from "amber"
import { route } from "amber-router"
import { LIB, type Exercise } from "@/lib/exercises"

export type SetType = "normal" | "warmup" | "drop" | "failure"
export type WSet = { type: SetType; kg: number | null; reps: number | null; rpe?: number | null; target?: number | null; done: boolean }
export type WExercise = { ex: string; rest: number | null; superset: number | null; sets: WSet[] }
export type Workout = { id: string; routine: string | null; name: string; start: string; minutes: number; exercises: WExercise[] }
export type Routine = { id: string; name: string; folder: string | null; exercises: { ex: string; rest?: number | null; superset?: number | null; sets: { type: SetType; reps: number | null }[] }[] }
export type Active = { id: string; name: string; routine: string | null; start: string; exercises: WExercise[]; rest?: { until: string; total: number; label: string } | null }

export const V = (): any => amber.data.values || {}
export const C = (n: string): any[] => (amber.data.collections && amber.data.collections[n]) || []
export const DEFAULTS = { unit: "kg", rest: 120, restWarmup: 60, showRpe: true, notify: true, bar: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] }
export const S = () => ({ ...DEFAULTS, ...(V().settings || {}) })
export const saveSettings = (p: object) => amber.setData({ values: { settings: p } })
export const uid = () => Math.random().toString(36).slice(2, 9)
export const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

// Exercises: the built-ins, plus the person's own.
export const allExercises = (): Exercise[] => [...LIB, ...(V().custom || []).map((x: Exercise) => ({ ...x, custom: true }))]
export const exById = (id: string): Exercise => allExercises().find((x) => x.id === id) || { id, name: id, muscle: "Other", other: [], equipment: "Other" }
export const MCOLOR: Record<string, string> = { Chest: "--c-red", Back: "--c-blue", Shoulders: "--c-violet", Biceps: "--c-teal", Triceps: "--c-pink", Forearms: "--c-olive", Abs: "--c-amber", Quads: "--c-green", Hamstrings: "--c-brown", Glutes: "--c-rose", Calves: "--c-sky", "Full body": "--c-amber", Cardio: "--c-sky", Other: "--c-brown" }

export const unit = () => S().unit as string
export const toUnit = (kg: number) => (S().unit === "lb" ? Math.round(kg * 2.20462 * 2) / 2 : Math.round(kg * 100) / 100)
export const fromUnit = (v: number) => (S().unit === "lb" ? v / 2.20462 : v)
export const fmtW = (kg: number) => { const v = toUnit(kg); return Number.isInteger(v) ? String(v) : String(v).replace(".", ",") }
export const parseNum = (s: unknown) => { const n = parseFloat(String(s ?? "").replace(",", ".")); return Number.isFinite(n) ? n : null }
export const e1rm = (kg: number, reps: number) => (reps <= 0 ? 0 : reps === 1 ? kg : kg * (1 + reps / 30))
export const working = (sets: WSet[]) => sets.filter((s) => s.done && s.type !== "warmup")
export const volume = (w: { exercises: WExercise[] }) => w.exercises.reduce((a, e) => a + working(e.sets).reduce((b, s) => b + (s.kg || 0) * (s.reps || 0), 0), 0)
export const fmtVol = (kg: number) => { const v = toUnit(kg); return v >= 10000 ? `${(v / 1000).toFixed(1).replace(".", ",")} t` : `${Math.round(v).toLocaleString("sv-SE")} ${unit()}` }
export const fmtDur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`)
export const fmtRest = (v: number) => (v ? `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}` : "Off")
export const TYPE_LETTER: Record<string, string> = { warmup: "W", drop: "D", failure: "F" }
export const TYPE_NAME: Record<SetType, string> = { normal: "Working set", warmup: "Warm-up", drop: "Drop set", failure: "To failure" }
export const setLabel = (sets: { type?: string }[], i: number) => {
  const t = sets[i].type || "normal"
  return t === "normal" ? String(sets.slice(0, i + 1).filter((x) => (x.type || "normal") === "normal").length) : TYPE_LETTER[t]
}
export const setText = (s: WSet, ex: Exercise) =>
  `${s.type === "warmup" ? "W " : s.type === "drop" ? "D " : s.type === "failure" ? "F " : ""}${s.kg ? `${fmtW(s.kg)}×` : ""}${s.reps || 0}${ex.equipment === "Bodyweight" && /plank/i.test(ex.name) ? "s" : ""}${s.rpe ? ` @${s.rpe}` : ""}`

// Days as yyyy-mm-dd, in the device's own calendar.
export const day = (iso: string) => iso.slice(0, 10)
export const today = () => new Date().toLocaleDateString("sv-SE")
export const D = {
  parse: (s: string) => new Date(s.slice(0, 10) + "T12:00:00Z"),
  iso: (d: Date) => d.toISOString().slice(0, 10),
  add: (s: string, n: number) => { const d = D.parse(s); d.setUTCDate(d.getUTCDate() + n); return D.iso(d) },
  diff: (a: string, b: string) => Math.round((+D.parse(a) - +D.parse(b)) / 864e5),
  wd: (s: string) => (D.parse(s).getUTCDay() + 6) % 7,
  fmt: (s: string, o: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) => D.parse(s).toLocaleDateString("en-GB", { timeZone: "UTC", ...o }),
}
export const rel = (s: string, t = today()) => { const n = D.diff(t, s); return n === 0 ? "Today" : n === 1 ? "Yesterday" : n < 7 ? D.fmt(s, { weekday: "long" }) : D.fmt(s, { day: "numeric", month: "short" }) }

// Finished workouts, newest first.
export const workouts = (): Workout[] => C("workouts").slice().sort((a, b) => (b.start || "").localeCompare(a.start || ""))
export const routines = (): Routine[] => V().routines || []
export const saveRoutines = (rs: Routine[]) => amber.store.set("routines", rs)

/** What this exercise was last time: the sets of the most recent workout that had it. */
export function previous(exId: string, beforeIso?: string): WSet[] {
  for (const w of workouts()) {
    if (beforeIso && w.start >= beforeIso) continue
    const e = w.exercises.find((x) => x.ex === exId)
    if (e) return e.sets.filter((s) => s.done)
  }
  return []
}
/** Last time's set to compare with: the same kind of set, by position. */
export function prevFor(prev: WSet[], sets: { type?: string }[], i: number) {
  const type = sets[i].type || "normal"
  const nth = sets.slice(0, i).filter((s) => (s.type || "normal") === type).length
  return prev.filter((s) => (s.type || "normal") === type)[nth] || null
}

/** Records from every finished workout, per session and overall, plus the heaviest weight at each rep count. */
export function records(exId: string, beforeIso?: string) {
  const r = { weight: 0, e1rm: 0, setVol: 0, reps: 0, sessions: [] as { date: string; weight: number; e1rm: number; vol: number; reps: number; wid: string }[], repMax: {} as Record<number, { kg: number; date: string; wid: string }> }
  for (const w of workouts().slice().reverse()) {
    if (beforeIso && w.start >= beforeIso) continue
    const e = w.exercises.find((x) => x.ex === exId); if (!e) continue
    const ws = working(e.sets); if (!ws.length) continue
    const best = { date: day(w.start), weight: 0, e1rm: 0, vol: 0, reps: 0, wid: w.id }
    for (const s of ws) {
      const kg = s.kg || 0, reps = s.reps || 0, v = kg * reps, one = e1rm(kg, reps)
      best.weight = Math.max(best.weight, kg); best.e1rm = Math.max(best.e1rm, one); best.vol += v; best.reps = Math.max(best.reps, reps)
      r.weight = Math.max(r.weight, kg); r.e1rm = Math.max(r.e1rm, one); r.setVol = Math.max(r.setVol, v); r.reps = Math.max(r.reps, reps)
      if (reps > 0 && kg > 0 && (!r.repMax[reps] || kg > r.repMax[reps].kg)) r.repMax[reps] = { kg, date: day(w.start), wid: w.id }
    }
    r.sessions.push(best)
  }
  return r
}
/** Rep maxes as a table: for each rep count, the heaviest weight lifted for at least that many reps. */
export function repMaxes(exId: string) {
  const m = records(exId).repMax, out: { reps: number; kg: number; date: string; wid: string; exact: boolean }[] = []
  const counts = Object.keys(m).map(Number).sort((a, b) => a - b), top = Math.max(0, ...counts)
  for (let n = 1; n <= Math.min(top, 15); n++) {
    const best = counts.filter((c) => c >= n).map((c) => ({ ...m[c], c })).sort((a, b) => b.kg - a.kg)[0]
    if (best) out.push({ reps: n, kg: best.kg, date: best.date, wid: best.wid, exact: best.c === n })
  }
  // Only the rows where the weight changes, so the table reads as steps.
  return out.filter((x, i) => i === out.length - 1 || x.kg !== out[i + 1].kg || x.exact)
}
/** The records a workout set, compared with everything before it. */
export function prsOf(w: Workout) {
  const out: { ex: string; kind: string; value: string }[] = []
  for (const e of w.exercises) {
    const before = records(e.ex, w.start), ws = working(e.sets)
    if (!ws.length || !before.sessions.length) continue
    const top = Math.max(...ws.map((s) => s.kg || 0)), one = Math.max(...ws.map((s) => e1rm(s.kg || 0, s.reps || 0)))
    if (top > before.weight + 1e-6) out.push({ ex: e.ex, kind: "Heaviest weight", value: `${fmtW(top)} ${unit()}` })
    else if (one > before.e1rm + 0.5) out.push({ ex: e.ex, kind: "Best est. 1RM", value: `${Math.round(toUnit(one))} ${unit()}` })
  }
  return out
}

// ---------- The workout in progress ----------
export const active = (): Active | null => V().active || null
export async function editActive(fn: (a: Active) => void) { const a = clone(active()!); fn(a); await amber.store.set("active", a) }
let restNote: string | null = null

/** A new workout: from a routine (its sets, with last time's weights) or empty. */
export async function startWorkout(r: Routine | null) {
  if (active()) { route("/live"); return }
  const exercises: WExercise[] = r ? r.exercises.map((e) => {
    const prev = previous(e.ex)
    return { ex: e.ex, rest: e.rest || null, superset: e.superset || null, sets: e.sets.map((s, i) => {
      const p = prevFor(prev, e.sets, i)
      return { type: s.type || "normal", kg: p ? p.kg : null, reps: null, target: s.reps || null, done: false }
    }) }
  }) : []
  await amber.store.set("active", { id: uid(), name: r ? r.name : "Workout", routine: r ? r.id : null, start: new Date().toISOString(), exercises })
  route("/live")
}
export const newExercise = (id: string): WExercise => {
  const prev = previous(id)
  return { ex: id, rest: null, superset: null, sets: [0, 1, 2].map((i) => ({ type: "normal" as SetType, kg: prev[i] ? prev[i].kg : null, reps: null, target: prev[i] ? prev[i].reps : null, done: false })) }
}
const restFor = (e: WExercise, s: WSet) => (s.type === "warmup" ? S().restWarmup : e.rest || S().rest)
/** In a superset, rest comes after the last exercise of the group. */
export function restsAfter(a: Active, ei: number) {
  const e = a.exercises[ei]; if (!e.superset) return true
  const next = a.exercises[ei + 1]
  return !(next && next.superset === e.superset)
}
export async function startRest(secs: number, label: string) {
  await editActive((a) => { a.rest = { until: new Date(Date.now() + secs * 1000).toISOString(), total: secs, label } })
  if (restNote) amber.device.notify.cancel(restNote)
  restNote = null
  if (S().notify) { const r = await amber.device.notify({ title: "Rest's over", body: label ? `Next: ${label}` : "Time for the next set.", in: secs }); if (r.ok) restNote = r.id }
}
export async function stopRest() { if (restNote) { amber.device.notify.cancel(restNote); restNote = null } await editActive((a) => { a.rest = null }) }
export async function nudgeRest(d: number) {
  const r = active()?.rest; if (!r) return
  const left = Math.max(5, Math.round((Date.parse(r.until) - Date.now()) / 1000) + d)
  await startRest(left, r.label)
  await editActive((a) => { a.rest!.total = Math.max(a.rest!.total + d, left) })
}
function nextUp(a: Active, ei: number, si: number) {
  for (let i = ei; i < a.exercises.length; i++) for (let k = i === ei ? si + 1 : 0; k < a.exercises[i].sets.length; k++) if (!a.exercises[i].sets[k].done) return exById(a.exercises[i].ex).name
  for (let i = 0; i < ei; i++) if (a.exercises[i].sets.some((s) => !s.done)) return exById(a.exercises[i].ex).name
  return ""
}
/** Check a set off (filling what's empty from last time or the target), then start the rest timer. */
export async function toggleSet(ei: number, si: number) {
  const a = active()!, e = a.exercises[ei], s = e.sets[si]
  const prev = prevFor(previous(e.ex, a.start), e.sets, si)
  await editActive((x) => {
    const t = x.exercises[ei].sets[si]
    if (!t.done) { if (t.kg == null && prev) t.kg = prev.kg; if (t.reps == null) t.reps = t.target || (prev && prev.reps) || null }
    t.done = !t.done
  })
  if (!s.done && restsAfter(a, ei)) startRest(restFor(e, s), nextUp(active()!, ei, si))
}
export async function discard() { if (restNote) { amber.device.notify.cancel(restNote); restNote = null } await amber.store.set("active", null); route("/") }
/** Only checked sets are kept. The workout goes into the workouts collection, in full. */
export async function finish() {
  const a = active()!
  const w: Workout = { id: a.id, routine: a.routine, name: a.name, start: a.start, minutes: Math.max(1, Math.round((Date.now() - Date.parse(a.start)) / 60000)),
    exercises: a.exercises.map((e) => ({ ex: e.ex, rest: e.rest, superset: e.superset, sets: e.sets.filter((s) => s.done).map(({ type, kg, reps, rpe }) => ({ type, kg: kg || 0, reps: reps || 0, done: true, ...(rpe ? { rpe } : {}) })) })).filter((e) => e.sets.length) }
  if (restNote) { amber.device.notify.cancel(restNote); restNote = null }
  await amber.batch(async () => { await amber.store.collection("workouts").add(w); await amber.store.set("active", null) })
  route(`/done/${w.id}`)
}

// ---------- Routines from workouts ----------
const routineExercises = (w: Workout) => w.exercises.map((e) => ({ ex: e.ex, rest: e.rest, superset: e.superset, sets: e.sets.map((s) => ({ type: s.type, reps: s.reps })) }))
export async function saveAsRoutine(w: Workout) {
  const r: Routine = { id: uid(), name: w.name, folder: null, exercises: routineExercises(w) }
  await saveRoutines([...routines(), r])
  route(`/routine/${r.id}`)
}
/** The routine becomes what was just done: its exercises, order, set types and reps. Name and folder stay. */
export async function updateRoutineFrom(w: Workout) {
  await saveRoutines(routines().map((r) => (r.id === w.routine ? { ...r, exercises: routineExercises(w) } : r)))
}
/** How the workout differs from its routine, in words (exercises added or left out, sets, order), or [] when it doesn't. */
export function routineChanges(w: Workout) {
  const r = routines().find((x) => x.id === w.routine); if (!r) return []
  const name = (id: string) => exById(id).name, had = r.exercises.map((e) => e.ex), did = w.exercises.map((e) => e.ex), out: string[] = []
  const added = did.filter((x) => !had.includes(x)), dropped = had.filter((x) => !did.includes(x))
  if (added.length) out.push(`adds ${added.map(name).join(", ")}`)
  if (dropped.length) out.push(`drops ${dropped.map(name).join(", ")}`)
  for (const e of w.exercises) { const o = r.exercises.find((x) => x.ex === e.ex); if (o && o.sets.length !== e.sets.length) out.push(`${name(e.ex)}: ${o.sets.length} → ${e.sets.length} sets`) }
  const kept = had.filter((x) => did.includes(x)), order = did.filter((x) => had.includes(x))
  if (JSON.stringify(kept) !== JSON.stringify(order)) out.push("changes the order")
  const types = (xs: { ex: string; sets: { type?: string }[] }[], id: string) => JSON.stringify(xs.find((e) => e.ex === id)?.sets.map((s) => s.type || "normal"))
  if (!out.length && did.some((id) => types(r.exercises, id) !== types(w.exercises, id))) out.push("changes set types")
  return out
}
export const differsFromRoutine = (w: Workout) => routineChanges(w).length > 0

// ---------- Export ----------
export function workoutsCSV() {
  const q = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const rows = [["Date", "Start", "Workout", "Minutes", "Exercise", "Set", "Type", `Weight (${unit()})`, "Reps", "RPE"]]
  for (const w of workouts().slice().reverse()) for (const e of w.exercises) e.sets.forEach((s, i) =>
    rows.push([day(w.start), w.start.slice(11, 16), w.name, String(w.minutes), exById(e.ex).name, setLabel(e.sets, i), s.type, s.kg ? String(toUnit(s.kg)) : "", String(s.reps ?? ""), s.rpe ? String(s.rpe) : ""]))
  return rows.map((r) => r.map(q).join(",")).join("\n")
}
export function everythingJSON() {
  const strip = ({ created, updated, ...x }: any) => x
  return JSON.stringify({ routines: routines(), folders: V().folders || [], custom: V().custom || [], settings: S(), workouts: workouts().map(strip), bodyweight: C("bodyweight").map(strip) }, null, 1)
}
