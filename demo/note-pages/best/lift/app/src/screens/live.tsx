// The workout in progress: one screen, no tabs, a table of sets per exercise and a rest bar.
import { useEffect, useState } from "react"
import { route } from "amber-router"
import { Reorder, useDragControls } from "framer-motion"
import { ArrowLeftRight, Check, ChevronDown, ChevronsUpDown, ChartColumn, GripVertical, Link2, MoreHorizontal, Plus, Timer, Trash2 } from "lucide-react"
import { Btn, Card, Empty, Glyph, Round, closeSheet, openSheet, rowCls } from "@/components/kit"
import { pickExercises } from "@/screens/picker"
import { cn } from "@/lib/utils"
import {
  active, editActive, exById, fmtRest, fmtVol, fmtW, finish, discard, fromUnit, newExercise, nudgeRest, parseNum, previous, prevFor, restsAfter,
  S, setLabel, stopRest, toggleSet, unit, volume, TYPE_NAME, type Active, type SetType,
} from "@/lib/lift"

export function Clock({ start }: { start: string }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t) }, [])
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(start)) / 1000))
  return <span className="tabular-nums">{s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}` : Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</span>
}

function RestBar({ rest }: { rest: NonNullable<Active["rest"]> }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(t) }, [])
  const left = Math.max(0, Math.round((Date.parse(rest.until) - Date.now()) / 1000))
  useEffect(() => { if (left <= 0) stopRest() }, [left <= 0])
  return (
    <div role="timer" aria-label={`Rest, ${left} seconds left`} className="fixed inset-x-0 z-25 border-t bg-background/92 px-4 pt-2.5 backdrop-blur-xl"
      style={{ bottom: "var(--amber-inset-bottom, 0px)", paddingBottom: "calc(.6rem + var(--amber-safe-bottom, 0px))" }}>
      <span className="absolute top-[-1px] left-0 h-[3px] bg-primary transition-[width] duration-1000 ease-linear" style={{ width: `${(1 - left / rest.total) * 100}%` }} />
      <div className="mx-auto flex max-w-3xl items-center gap-2.5">
        <div className="min-w-0 flex-1"><div className="min-w-[4.2ch] font-[ui-rounded] text-[1.6rem] font-extrabold tabular-nums">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</div>
          <div className="truncate text-xs text-muted-foreground">{rest.label ? `Rest · next ${rest.label}` : "Rest"}</div></div>
        <Btn className="min-h-10 px-3" onClick={() => nudgeRest(-15)} aria-label="Fifteen seconds less">−15</Btn>
        <Btn className="min-h-10 px-3" onClick={() => nudgeRest(15)} aria-label="Fifteen seconds more">+15</Btn>
        <Btn tone="primary" className="min-h-10 px-3.5" onClick={stopRest}>Skip</Btn>
      </div>
    </div>
  )
}

const typeColor: Record<string, string> = { warmup: "text-warm", drop: "text-drop", failure: "text-fail", normal: "text-foreground" }
const cell = "h-10 w-full min-w-0 rounded-[.55rem] border-0 bg-muted px-1 text-center text-base font-bold text-foreground placeholder:font-medium placeholder:text-muted-foreground/70"

function SetRow({ a, ei, si, showRpe }: { a: Active; ei: number; si: number; showRpe: boolean }) {
  const e = a.exercises[ei], s = e.sets[si], ex = exById(e.ex)
  const prev = prevFor(previous(e.ex, a.start), e.sets, si)
  const label = setLabel(e.sets, si), bw = ex.equipment === "Bodyweight"
  const put = (k: "kg" | "reps" | "rpe") => (ev: { target: EventTarget | null }) => {
    const v = parseNum((ev.target as HTMLInputElement).value)
    editActive((x) => { (x.exercises[ei].sets[si] as any)[k] = v == null ? null : k === "kg" ? fromUnit(v) : v })
  }
  const done = s.done && "bg-ok/14"
  return <>
    <button onClick={() => setMenu(ei, si)} aria-label={`Set ${label}, ${s.type === "normal" ? "working set" : s.type + " set"}. Change type`}
      className={cn("h-10 rounded-[.55rem] bg-muted text-[15px] font-extrabold", typeColor[s.type], done)}>{label}</button>
    <span className="truncate text-[13px] text-muted-foreground">{prev ? `${prev.kg ? fmtW(prev.kg) + " × " : ""}${prev.reps}` : "–"}</span>
    <input key={"kg" + s.kg} inputMode="decimal" className={cn(cell, done)} aria-label={`${ex.name} set ${label}, ${unit()}`} placeholder={prev && prev.kg ? fmtW(prev.kg) : bw ? "0" : "–"} defaultValue={s.kg != null ? fmtW(s.kg) : ""} onChange={put("kg")} />
    <input key={"r" + s.reps} inputMode="numeric" className={cn(cell, done)} aria-label={`${ex.name} set ${label}, reps`} placeholder={String(s.target || (prev && prev.reps) || "–")} defaultValue={s.reps ?? ""} onChange={put("reps")} />
    {showRpe ? <input key={"p" + s.rpe} inputMode="decimal" className={cn(cell, done, "max-[360px]:hidden")} aria-label={`${ex.name} set ${label}, RPE`} placeholder="RPE" defaultValue={s.rpe ?? ""} onChange={put("rpe")} /> : <span />}
    <button onClick={() => toggleSet(ei, si)} aria-pressed={s.done} aria-label={`${ex.name} set ${label} ${s.done ? "done" : "not done"}`}
      className={cn("grid size-10 place-items-center rounded-[.55rem] transition active:scale-90", s.done ? "animate-[tickpop_.35s_cubic-bezier(.3,1.4,.5,1)] bg-ok text-white" : "bg-muted text-muted-foreground")}>
      <Check className="size-5" strokeWidth={3} /></button>
  </>
}

const menuRow = cn(rowCls, "min-h-13 [&>svg]:size-5 [&>svg]:text-primary")
function setMenu(ei: number, si: number) {
  const s = active()!.exercises[ei].sets[si]
  const pick = (t: SetType) => { editActive((a) => { a.exercises[ei].sets[si].type = t }); closeSheet() }
  openSheet({ title: "Set type", body: () => (
    <div className="divide-y overflow-hidden rounded-xl bg-card">
      {(["normal", "warmup", "drop", "failure"] as SetType[]).map((t) => (
        <button key={t} className={menuRow} onClick={() => pick(t)}>
          <span className={cn("grid w-9 place-items-center rounded-lg bg-muted py-1 font-extrabold", typeColor[t])}>{t === "normal" ? "1" : t[0].toUpperCase()}</span>
          <span className="flex-1">{TYPE_NAME[t]}</span>{s.type === t && <Check className="size-5 text-primary" />}
        </button>
      ))}
      <button className={cn(menuRow, "text-destructive [&>svg]:text-destructive")} onClick={() => { editActive((a) => { a.exercises[ei].sets.splice(si, 1) }); closeSheet() }}><Trash2 /><span className="flex-1">Remove this set</span></button>
    </div>
  ) })
}

function exMenu(ei: number) {
  const a = active()!, e = a.exercises[ei], ex = exById(e.ex), n = a.exercises.length
  const act = (fn: (x: Active) => void) => () => { editActive(fn); closeSheet() }
  openSheet({ title: ex.name, body: () => (
    <div className="divide-y overflow-hidden rounded-xl bg-card">
      <button className={menuRow} onClick={() => { closeSheet(); setTimeout(() => pickExercises((ids) => editActive((x) => { x.exercises[ei].ex = ids[0]; x.exercises[ei].sets.forEach((s) => { s.kg = null; s.done = false }) }), { single: true }), 60) }}>
        <ArrowLeftRight /><span className="flex-1">Replace exercise</span></button>
      {n > 1 && <button className={menuRow} onClick={() => { closeSheet(); setTimeout(reorderSheet, 60) }}><ChevronsUpDown /><span className="flex-1">Reorder exercises</span></button>}
      {e.superset ? <button className={menuRow} onClick={act((x) => { x.exercises[ei].superset = null })}><Link2 /><span className="flex-1">Remove from superset</span></button>
        : ei < n - 1 ? <button className={menuRow} onClick={act((x) => { const g = x.exercises[ei + 1].superset || Math.max(0, ...x.exercises.map((y) => y.superset || 0)) + 1; x.exercises[ei].superset = g; x.exercises[ei + 1].superset = g })}>
          <Link2 /><span className="flex-1">Superset with {exById(a.exercises[ei + 1].ex).name}</span></button> : null}
      <div className={menuRow}><Timer /><span className="flex-1">Rest after each set</span>
        <select aria-label="Rest time" defaultValue={String(e.rest || S().rest)} onChange={(ev) => editActive((x) => { x.exercises[ei].rest = +ev.target.value })} className="min-h-10 rounded-lg bg-muted px-2.5">
          {[0, 30, 45, 60, 90, 120, 150, 180, 240, 300].map((v) => <option key={v} value={v}>{fmtRest(v)}</option>)}</select></div>
      <button className={menuRow} onClick={() => { closeSheet(); route(`/exercise/${e.ex}`) }}><ChartColumn /><span className="flex-1">History and records</span></button>
      <button className={cn(menuRow, "text-destructive [&>svg]:text-destructive")} onClick={act((x) => { x.exercises.splice(ei, 1) })}><Trash2 /><span className="flex-1">Remove exercise</span></button>
    </div>
  ) })
}

/** Drag by the handle to put the exercises in a new order; it's saved as you let go. */
export function ReorderList<T>({ items, keyOf, render, onDone, label }: { items: T[]; keyOf: (t: T) => string; render: (t: T) => React.ReactNode; onDone: (order: T[]) => void; label: string }) {
  const [order, setOrder] = useState(items)
  return (
    <Reorder.Group axis="y" values={order} onReorder={setOrder} className="grid gap-2" aria-label={label}>
      {order.map((t) => <ReorderRow key={keyOf(t)} value={t} onDrop={() => onDone(order)}>{render(t)}</ReorderRow>)}
    </Reorder.Group>
  )
}
function ReorderRow<T>({ value, children, onDrop }: { value: T; children: React.ReactNode; onDrop: () => void }) {
  const controls = useDragControls()
  return (
    <Reorder.Item value={value} dragListener={false} dragControls={controls} onDragEnd={onDrop}
      className="flex min-h-14 items-center gap-3 rounded-xl bg-card px-3 select-none" whileDrag={{ scale: 1.02, boxShadow: "0 10px 30px rgba(0,0,0,.18)" }}>
      {children}
      <span role="button" aria-label="Drag to reorder" onPointerDown={(e) => controls.start(e)} className="grid size-10 cursor-grab touch-none place-items-center text-muted-foreground"><GripVertical className="size-5" /></span>
    </Reorder.Item>
  )
}
function reorderSheet() {
  const a = active()!
  let latest = a.exercises.map((e, i) => ({ ...e, key: String(i) }))
  openSheet({ title: "Reorder exercises", description: "Drag the handles.", body: () => (
    <ReorderList label="Exercises" items={latest} keyOf={(e) => e.key} onDone={(o) => { latest = o }}
      render={(e) => <><Glyph ex={e.ex} sm /><span className="min-w-0 flex-1 truncate font-semibold">{exById(e.ex).name}</span></>} />
  ), foot: () => <Btn tone="primary" onClick={() => { editActive((x) => { x.exercises = latest.map(({ key, ...e }) => e) }); closeSheet() }}>Done</Btn> })
}

const SSCOLORS = ["--c-violet", "--c-teal", "--c-pink", "--c-sky"]
export default function Live() {
  const a = active()
  if (!a) return <div className="pt-16"><Empty title="No workout running">Start one from Workout.<Btn tone="primary" className="mt-3" onClick={() => route("/")}>Back to Workout</Btn></Empty></div>
  const s = S(), done = a.exercises.reduce((n, e) => n + e.sets.filter((x) => x.done).length, 0)
  const groups: Record<number, number> = {}
  a.exercises.forEach((e) => { if (e.superset && !(e.superset in groups)) groups[e.superset] = Object.keys(groups).length })
  const grid = cn("grid items-center gap-x-1.5 gap-y-1.5 px-3 pb-2 min-[700px]:gap-x-2", s.showRpe
    ? "grid-cols-[2rem_minmax(3.3rem,1fr)_minmax(3.4rem,4.6rem)_minmax(2.8rem,4rem)_minmax(2.5rem,3rem)_2.5rem] max-[360px]:grid-cols-[1.9rem_minmax(2.8rem,1fr)_minmax(3.2rem,4rem)_minmax(2.7rem,3.4rem)_2.4rem]"
    : "grid-cols-[2rem_minmax(3.3rem,1fr)_minmax(3.4rem,4.6rem)_minmax(2.8rem,4rem)_0_2.5rem]")
  return (
    <div className="mx-auto max-w-3xl px-4 pb-40" style={{ paddingBottom: "calc(10rem + var(--amber-safe-bottom, 0px))" }}>
      <header className="sticky top-0 z-20 mb-3 flex items-center gap-2.5 border-b bg-background pt-2.5 pb-3">
        <Round onClick={() => route("/")} aria-label="Minimize the workout"><ChevronDown /></Round>
        <div className="min-w-0 flex-1">
          <input key={a.name} aria-label="Workout name" defaultValue={a.name} onChange={(ev) => editActive((x) => { x.name = ev.target.value.trim() || x.name })} className="w-full min-w-0 truncate bg-transparent text-[1.05rem] font-extrabold outline-none" />
          <div className="flex gap-1.5 truncate text-sm whitespace-nowrap text-muted-foreground">
            <b className="font-[ui-rounded] text-[1.05rem] font-extrabold text-foreground"><Clock start={a.start} /></b><span>·</span><span className="tabular-nums">{fmtVol(volume(a))}</span><span>·</span><span className="tabular-nums">{done} {done === 1 ? "set" : "sets"}</span>
          </div>
        </div>
        <Btn tone="ok" onClick={finishSheet}>Finish</Btn>
      </header>

      {a.exercises.length ? a.exercises.map((e, ei) => {
        const ex = exById(e.ex), ssc = e.superset ? SSCOLORS[groups[e.superset] % SSCOLORS.length] : null, rest = e.rest || s.rest
        return (
          <Card key={ei + e.ex} aria-label={ex.name} className={cn("mb-3.5", ssc && "border-l-4")} style={ssc ? { borderLeftColor: `var(${ssc})` } : undefined}>
            <div className="flex items-center gap-3 px-3.5 pt-3 pb-1">
              <Glyph ex={ex} sm />
              <div className="min-w-0 flex-1"><h3 className="truncate text-[1.05rem] font-bold text-primary">{ex.name}</h3>
                {ssc && <span className="text-[11px] font-extrabold tracking-wider uppercase" style={{ color: `var(${ssc})` }}>Superset {String.fromCharCode(65 + groups[e.superset!])}</span>}</div>
              <Round onClick={() => exMenu(ei)} aria-label={`More for ${ex.name}`}><MoreHorizontal /></Round>
            </div>
            <div className="flex items-center gap-1.5 px-3.5 pb-1.5 text-[13px] text-muted-foreground"><Timer className="size-4" />Rest {fmtRest(rest)}{e.superset && !restsAfter(a, ei) ? " · after the superset" : ""}</div>
            <div className={grid}>
              {["Set", "Prev", unit(), "Reps"].map((h, i) => <span key={h} className={cn("text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase", i === 1 ? "text-left" : "text-center")}>{h}</span>)}
              {s.showRpe ? <span className="text-center text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase max-[360px]:hidden">RPE</span> : <span />}
              <span className="grid place-items-center text-muted-foreground"><Check className="size-4" /></span>
              {e.sets.map((_, si) => <SetRow key={si} a={a} ei={ei} si={si} showRpe={s.showRpe} />)}
            </div>
            <Btn className="mx-3 mb-3 min-h-10 w-[calc(100%-1.5rem)] rounded-lg" onClick={() => editActive((x) => { const l = x.exercises[ei].sets.at(-1); x.exercises[ei].sets.push({ type: "normal", kg: l ? l.kg : null, reps: null, target: l ? l.target : null, done: false }) })}><Plus /> Add set</Btn>
          </Card>
        )
      }) : <Card><Empty title="An empty workout">Add the exercises you're doing. Each one keeps its sets, the weights from last time and a rest timer.</Empty></Card>}

      <div className="mt-4 grid gap-2.5">
        <Btn tone="tint" big onClick={() => pickExercises((ids) => editActive((x) => { ids.forEach((id) => x.exercises.push(newExercise(id))) }))}><Plus /> Add exercises</Btn>
        {a.exercises.length > 1 && <Btn onClick={reorderSheet}><ChevronsUpDown /> Reorder</Btn>}
        <Btn tone="danger" onClick={discardSheet}>Discard workout</Btn>
      </div>
      {a.rest && <RestBar rest={a.rest} />}
    </div>
  )
}

function discardSheet() {
  openSheet({ title: "Discard this workout?", body: () => <p className="text-muted-foreground">Nothing from it is saved.</p>,
    foot: () => <><Btn onClick={closeSheet}>Keep going</Btn><Btn className="bg-destructive text-white" onClick={() => { closeSheet(); discard() }}>Discard</Btn></> })
}
function finishSheet() {
  const a = active()!, left = a.exercises.reduce((n, e) => n + e.sets.filter((s) => !s.done).length, 0), done = a.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0)
  if (!left) { finish(); return }
  openSheet({ title: done ? "Finish the workout?" : "Nothing done yet",
    body: () => <p className="text-muted-foreground">{done ? `${left} ${left === 1 ? "set isn't" : "sets aren't"} checked. Only checked sets are saved.` : "Check off at least one set, or discard the workout."}</p>,
    foot: () => <><Btn onClick={closeSheet}>Keep going</Btn>{done ? <Btn tone="ok" onClick={() => { closeSheet(); finish() }}>Finish</Btn> : null}</> })
}
