// Workout: start one. Up next, an empty workout, and the routines in their folders.
import { Fragment, useState } from "react"
import { route } from "amber-router"
import { amber } from "amber"
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ChevronsUpDown, Copy, Dumbbell, Folder, MoreHorizontal, Play, Plus, Trash2, X } from "lucide-react"
import { Btn, Card, Empty, Field, Glyph, Label, Round, Screen, Top, closeSheet, inputCls, openSheet, rowCls } from "@/components/kit"
import { ReorderList } from "@/screens/live"
import { pickExercises } from "@/screens/picker"
import { cn } from "@/lib/utils"
import { active, clone, D, day, exById, fmtRest, parseNum, rel, routines, S, saveRoutines, setLabel, startWorkout, today, uid, V, workouts, type Routine, type SetType } from "@/lib/lift"

const summaryOf = (r: Routine) => r.exercises.map((e) => exById(e.ex).name).join(", ")
const lastDone = (rid: string) => workouts().find((w) => w.routine === rid)
const menuRow = cn(rowCls, "min-h-13 [&>svg]:size-5 [&>svg]:text-primary")

export default function Home() {
  const rs = routines(), folders = [...new Set([...(V().folders || []), ...rs.map((r) => r.folder).filter(Boolean)])] as string[]
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  const ws = workouts(), t = today(), wk0 = D.add(t, -D.wd(t)), week = ws.filter((w) => day(w.start) >= wk0).length
  const next = (() => { const last = ws[0]; if (!last || !last.routine) return rs[0]; const i = rs.findIndex((r) => r.id === last.routine); return rs[(i + 1) % rs.length] })()
  const card = (r: Routine) => {
    const l = lastDone(r.id)
    return (
      <Card key={r.id} className="px-4 py-3.5">
        <h3 className="flex items-center gap-1.5 text-[1.05rem] font-bold"><span className="min-w-0 flex-1 truncate">{r.name}</span>
          <Round className="size-9" onClick={() => routineMenu(r)} aria-label={`More for ${r.name}`}><MoreHorizontal /></Round></h3>
        <p className="mt-0.5 mb-3 truncate text-sm text-muted-foreground">{summaryOf(r) || "No exercises yet"}</p>
        <div className="flex items-center gap-1.5">
          <Btn tone="primary" onClick={() => startWorkout(r)}><Play className="fill-current" /> Start</Btn>
          <Btn onClick={() => route(`/routine/${r.id}`)}>Edit</Btn>
          <span className="flex-1" /><span className="text-[13px] text-muted-foreground">{l ? rel(day(l.start), t) : "Not done yet"}</span>
        </div>
      </Card>
    )
  }
  const group = (name: string, list: Routine[], key: string) => (
    <div key={key}>
      <div className="flex items-center">
        <button aria-expanded={!closed[key]} onClick={() => setClosed({ ...closed, [key]: !closed[key] })}
          className="flex min-h-11 flex-1 items-center gap-1.5 px-0.5 text-xs font-bold tracking-wider text-muted-foreground uppercase">
          <ChevronDown className={cn("size-4 transition-transform", closed[key] && "-rotate-90")} /><span className="flex-1 text-left">{name}</span><span className="tabular-nums">{list.length}</span></button>
        {list.length > 1 && !closed[key] && <button className="ml-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary" onClick={() => reorderRoutines(list)}><ChevronsUpDown className="size-4" />Reorder</button>}
      </div>
      {closed[key] ? null : list.length ? <div className="grid gap-2.5 min-[900px]:grid-cols-2">{list.map(card)}</div>
        : <p className="mx-0.5 text-sm text-muted-foreground">Empty. Move a routine here from its menu.</p>}
    </div>
  )
  const loose = rs.filter((r) => !r.folder)
  return (
    <Screen>
      <Top title="Workout" sub={week ? `${week} ${week === 1 ? "workout" : "workouts"} this week` : "Nothing yet this week"} />
      {!active() && (
        <section className="grid gap-2.5">
          {next && (
            <button onClick={() => startWorkout(next)} className="flex min-h-[4.6rem] w-full min-w-0 items-center gap-3 rounded-xl bg-card p-4 text-left active:bg-muted">
              <span className="grid size-[2.6rem] place-items-center rounded-[.8rem] bg-primary/15 text-primary"><Play className="size-5 fill-current" /></span>
              <span className="min-w-0 flex-1"><span className="text-xs font-bold tracking-wider text-muted-foreground uppercase">Up next</span>
                <b className="block text-lg">{next.name}</b><span className="block truncate text-sm text-muted-foreground">{summaryOf(next)}</span></span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
          )}
          <Btn big onClick={() => startWorkout(null)}><Plus /> Start an empty workout</Btn>
        </section>
      )}
      <Label><span className="flex-1">Routines</span><button onClick={newFolder}>New folder</button><button onClick={newRoutine}>New routine</button></Label>
      <div className="grid gap-1">
        {folders.map((f) => group(f, rs.filter((r) => r.folder === f), f))}
        {loose.length > 0 && group("Other routines", loose, "")}
      </div>
      {!rs.length && <Card><Empty icon={Dumbbell} title="No routines yet">A routine is a workout you repeat: its exercises, sets and rest times.<Btn tone="primary" className="mt-3" onClick={newRoutine}><Plus /> New routine</Btn></Empty></Card>}
    </Screen>
  )
}

async function newRoutine() { const r: Routine = { id: uid(), name: "New routine", folder: null, exercises: [] }; await saveRoutines([...routines(), r]); route(`/routine/${r.id}`) }
function newFolder() {
  let name = ""
  openSheet({ title: "New folder", body: () => <Field label="Name"><input className={inputCls} autoFocus placeholder="Upper / lower" onInput={(e) => (name = (e.target as HTMLInputElement).value)} /></Field>,
    foot: () => <Btn tone="primary" onClick={() => { if (name.trim()) amber.setData({ values: { folders: [...(V().folders || []), name.trim()] } }); closeSheet() }}>Add folder</Btn> })
}
function reorderRoutines(list: Routine[]) {
  let order = list
  openSheet({ title: "Reorder routines", description: "Drag the handles.", body: () => (
    <ReorderList label="Routines" items={list} keyOf={(r) => r.id} onDone={(o) => { order = o }} render={(r) => <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>} />
  ), foot: () => <Btn tone="primary" onClick={() => {
    // The folder's routines take their new order in the places they held.
    const rs = routines(), slots = rs.map((r, i) => [r, i] as const).filter(([r]) => list.some((x) => x.id === r.id)).map(([, i]) => i), out = rs.slice()
    slots.forEach((slot, k) => { out[slot] = rs.find((r) => r.id === order[k].id)! })
    saveRoutines(out); closeSheet()
  }}>Done</Btn> })
}
function routineMenu(r: Routine) {
  const rs = routines(), folders: string[] = V().folders || []
  openSheet({ title: r.name, body: () => (
    <div className="divide-y overflow-hidden rounded-xl bg-card">
      <div className={menuRow}><Folder /><span className="flex-1">Folder</span>
        <select aria-label="Folder" defaultValue={r.folder || ""} onChange={(e) => { saveRoutines(rs.map((x) => (x.id === r.id ? { ...x, folder: e.target.value || null } : x))); closeSheet() }} className="min-h-10 max-w-44 rounded-lg bg-muted px-2.5">
          <option value="">None</option>{folders.map((f) => <option key={f}>{f}</option>)}</select></div>
      <button className={menuRow} onClick={() => { saveRoutines([...rs, { ...clone(r), id: uid(), name: r.name + " (copy)" }]); closeSheet() }}><Copy /><span className="flex-1">Duplicate</span></button>
      <button className={cn(menuRow, "text-destructive [&>svg]:text-destructive")} onClick={() => { saveRoutines(rs.filter((x) => x.id !== r.id)); closeSheet() }}><Trash2 /><span className="flex-1">Delete routine</span></button>
    </div>
  ) })
}

const TYPES: [SetType, string][] = [["normal", "Working"], ["warmup", "Warm-up"], ["drop", "Drop"], ["failure", "Failure"]]
export function RoutineEdit({ id }: { id: string }) {
  const rs = routines(), r = rs.find((x) => x.id === id)
  if (!r) return <Screen><Top title="Routine" backTo="Workout" /><p className="text-muted-foreground">This routine is gone.</p></Screen>
  const save = (fn: (x: Routine) => void) => { const c = clone(rs); fn(c.find((x) => x.id === id)!); saveRoutines(c) }
  const reorder = () => {
    let order = r.exercises.map((e, i) => ({ ...e, key: String(i) }))
    openSheet({ title: "Reorder exercises", description: "Drag the handles.", body: () => (
      <ReorderList label="Exercises" items={order} keyOf={(e) => e.key} onDone={(o) => { order = o }} render={(e) => <><Glyph ex={e.ex} sm /><span className="min-w-0 flex-1 truncate font-semibold">{exById(e.ex).name}</span></>} />
    ), foot: () => <Btn tone="primary" onClick={() => { save((x) => { x.exercises = order.map(({ key, ...e }) => e) }); closeSheet() }}>Done</Btn> })
  }
  return (
    <Screen>
      <Top title={r.name} sub={`${r.exercises.length} exercises · ${r.exercises.reduce((n, e) => n + e.sets.length, 0)} sets`} backTo="Workout">
        <Btn tone="primary" onClick={() => startWorkout(r)}><Play className="fill-current" /> Start</Btn>
      </Top>
      <div className="mb-3.5 flex items-end gap-2.5">
        <div className="flex-1"><Field label="Name"><input key={r.name} className={inputCls} defaultValue={r.name} onChange={(e) => save((x) => { x.name = e.target.value.trim() || x.name })} /></Field></div>
        {r.exercises.length > 1 && <Btn onClick={reorder}><ChevronsUpDown /> Reorder</Btn>}
      </div>
      {r.exercises.map((e, ei) => {
        const ex = exById(e.ex)
        return (
          <Card key={ei + e.ex} className="mb-3 pb-1.5">
            <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-2"><Glyph ex={ex} sm /><h3 className="min-w-0 flex-1 truncate text-[1.05rem] font-bold text-primary">{ex.name}</h3>
              <Round className="bg-transparent text-muted-foreground" disabled={!ei} onClick={() => save((x) => { const [m] = x.exercises.splice(ei, 1); x.exercises.splice(ei - 1, 0, m) })} aria-label={`Move ${ex.name} up`}><ArrowUp /></Round>
              <Round className="bg-transparent text-muted-foreground" disabled={ei === r.exercises.length - 1} onClick={() => save((x) => { const [m] = x.exercises.splice(ei, 1); x.exercises.splice(ei + 1, 0, m) })} aria-label={`Move ${ex.name} down`}><ArrowDown /></Round>
              <Round className="bg-transparent text-muted-foreground" onClick={() => save((x) => { x.exercises.splice(ei, 1) })} aria-label={`Remove ${ex.name}`}><Trash2 /></Round></div>
            <div className="grid grid-cols-[2.2rem_minmax(0,1fr)_4.4rem_2.4rem] items-center gap-x-2 gap-y-1.5 px-3.5 pb-1.5">
              {["Set", "Type", "Reps", ""].map((h, i) => <span key={i} className={cn("text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase", i !== 1 && "text-center")}>{h}</span>)}
              {e.sets.map((s, si) => <Fragment key={si}>
                <span key={"n" + si} className="grid h-9 place-items-center rounded-lg bg-muted font-extrabold">{setLabel(e.sets, si)}</span>
                <select key={"t" + si} aria-label="Set type" value={s.type || "normal"} onChange={(ev) => save((x) => { x.exercises[ei].sets[si].type = ev.target.value as SetType })} className="h-9 min-w-0 rounded-lg bg-muted px-2">
                  {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                <input key={"r" + si + s.reps} inputMode="numeric" aria-label="Target reps" defaultValue={s.reps || ""} onChange={(ev) => save((x) => { x.exercises[ei].sets[si].reps = parseNum(ev.target.value) })} className="h-9 w-full rounded-lg bg-muted text-center font-bold" />
                <Round key={"x" + si} className="size-9 bg-transparent text-muted-foreground" onClick={() => save((x) => { x.exercises[ei].sets.splice(si, 1) })} aria-label="Remove set"><X /></Round>
              </Fragment>)}
            </div>
            <div className="flex flex-wrap items-center gap-2 px-3.5 pb-2">
              <Btn className="min-h-9" onClick={() => save((x) => { const l = x.exercises[ei].sets.at(-1); x.exercises[ei].sets.push({ type: "normal", reps: l ? l.reps : 8 }) })}><Plus /> Set</Btn>
              <span className="flex-1" /><span className="text-sm text-muted-foreground">Rest</span>
              <select aria-label="Rest" value={String(e.rest || S().rest)} onChange={(ev) => save((x) => { x.exercises[ei].rest = +ev.target.value })} className="min-h-9 rounded-lg bg-muted px-2">
                {[60, 90, 120, 150, 180, 240].map((v) => <option key={v} value={v}>{fmtRest(v)}</option>)}</select>
            </div>
          </Card>
        )
      })}
      <Btn tone="tint" big className="w-full" onClick={() => pickExercises((ids) => save((x) => { ids.forEach((id2) => x.exercises.push({ ex: id2, rest: null, sets: [{ type: "normal", reps: 8 }, { type: "normal", reps: 8 }, { type: "normal", reps: 8 }] })) }))}><Plus /> Add exercises</Btn>
    </Screen>
  )
}
