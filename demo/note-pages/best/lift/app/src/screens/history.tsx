// After a workout (the summary), History (a month calendar and the workouts in it), one workout.
import { useState } from "react"
import { back, route } from "amber-router"
import { amber } from "amber"
import { toast } from "sonner"
import { Check, ChevronLeft, ChevronRight, Copy, RefreshCw, Trash2, Trophy } from "lucide-react"
import { Btn, Card, Empty, Glyph, Label, List, Round, Screen, Top, closeSheet, openSheet } from "@/components/kit"
import { cn } from "@/lib/utils"
import {
  C, D, day, differsFromRoutine, routineChanges, e1rm, exById, fmtDur, fmtVol, fmtW, prsOf, rel, routines, saveAsRoutine, setLabel, setText, today, toUnit,
  unit, updateRoutineFrom, volume, working, workouts, type Workout,
} from "@/lib/lift"

const Kpis = ({ items, tinted }: { items: [string, string | number][]; tinted?: boolean }) => (
  <div className="mt-4 grid grid-cols-4 gap-2 max-[520px]:grid-cols-2">
    {items.map(([k, v]) => <div key={k} className={cn("rounded-xl px-1.5 py-2.5 text-center", tinted ? "bg-card" : "bg-background dark:bg-muted")}>
      <b className="block font-[ui-rounded] text-[1.35rem] font-extrabold tracking-tight tabular-nums">{v}</b><span className="text-xs font-semibold text-muted-foreground">{k}</span></div>)}
  </div>
)
const setsOf = (w: Workout) => w.exercises.reduce((n, e) => n + working(e.sets).length, 0)

export function Done({ id }: { id: string }) {
  const w = C("workouts").find((x) => x.id === id) as Workout | undefined
  const [updated, setUpdated] = useState(false)
  if (!w) return <Screen><p className="text-muted-foreground">Saved.</p></Screen>
  const prs = prsOf(w), nth = workouts().length, routine = routines().find((r) => r.id === w.routine), differs = differsFromRoutine(w)
  return (
    <Screen>
      <Card className="px-5 pt-6 pb-5 text-center">
        {prs.length ? <Trophy className="mx-auto mb-1.5 size-12 animate-[tickpop_.6s_cubic-bezier(.3,1.4,.5,1)] text-warm" /> : <Check className="mx-auto mb-1.5 size-12 text-ok" />}
        <h2 className="text-[1.6rem] font-extrabold tracking-tight">{prs.length ? "New records" : "Nice work"}</h2>
        <p className="text-muted-foreground">Workout number {nth} · {w.name}</p>
        <Kpis items={[["Duration", fmtDur(w.minutes)], ["Volume", fmtVol(volume(w))], ["Sets", setsOf(w)], ["Records", prs.length]]} />
      </Card>
      {prs.length > 0 && <><Label>Records</Label><List>{prs.map((p) => (
        <div key={p.ex + p.kind} className="flex min-h-14 items-center gap-3 px-4"><Glyph ex={p.ex} sm /><span className="min-w-0 flex-1"><b>{exById(p.ex).name}</b><div className="text-sm text-muted-foreground">{p.kind}</div></span><b className="tabular-nums">{p.value}</b></div>
      ))}</List></>}
      <Label>What you did</Label>
      <List>{w.exercises.map((e) => (
        <div key={e.ex} className="px-4 py-2.5"><b>{working(e.sets).length} × {exById(e.ex).name}</b><div className="text-sm text-muted-foreground">{e.sets.map((s) => setText(s, exById(e.ex))).join(" · ")}</div></div>
      ))}</List>
      <div className="mt-4 grid gap-2.5">
        {routine && differs && !updated && (
          <Card className="grid gap-2.5 p-4">
            <p className="text-[15px]"><b>This was different from {routine.name}.</b> <span className="text-muted-foreground">Updating it {routineChanges(w).join(", ")}. Weights aren't part of a routine; they come from your last workout.</span></p>
            <Btn tone="tint" onClick={async () => { await updateRoutineFrom(w); setUpdated(true); toast.success(`${routine.name} updated`) }}><RefreshCw /> Update {routine.name}</Btn>
          </Card>
        )}
        {updated && <p className="flex items-center gap-1.5 px-1 font-semibold text-ok"><Check className="size-4" /> {routine!.name} now matches this workout.</p>}
        {!w.routine && <Btn tone="tint" big onClick={() => saveAsRoutine(w)}><Copy /> Save as a routine</Btn>}
        <Btn tone="primary" big onClick={() => route("/")}>Done</Btn>
      </div>
    </Screen>
  )
}

export function History() {
  const t = today(), [month, setMonth] = useState(t.slice(0, 7))
  const ws = workouts(), days = new Set(ws.map((w) => day(w.start)))
  const first = month + "-01", lead = D.wd(first), dim = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate()
  const shift = (n: number) => setMonth(new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7))
  const inMonth = ws.filter((w) => w.start.slice(0, 7) === month)
  // Weeks in a row with at least one workout, up to this one.
  let streak = 0
  for (let k = 0; k < 60; k++) { const s = D.add(t, -D.wd(t) - 7 * k); if (ws.some((w) => day(w.start) >= s && day(w.start) < D.add(s, 7))) streak++; else if (k > 0) break }
  return (
    <Screen wide>
      <Top title="History" sub={`${ws.length} workouts · ${streak}-week streak`} />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-6 min-[1000px]:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div>
          <Card className="px-4 pt-3.5 pb-4">
            <div className="mb-2.5 flex items-center gap-2"><b className="flex-1 text-[1.05rem]">{D.fmt(first, { month: "long", year: "numeric" })}</b>
              <Round onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft /></Round><Round onClick={() => shift(1)} aria-label="Next month"><ChevronRight /></Round></div>
            <div className="grid grid-cols-7 gap-1 text-center">
              {["M", "T", "W", "T", "F", "S", "S"].map((x, i) => <span key={i} className="pb-1 text-[11px] font-bold text-muted-foreground">{x}</span>)}
              {Array.from({ length: lead }, (_, i) => <span key={"l" + i} />)}
              {Array.from({ length: dim }, (_, i) => {
                const d = `${month}-${String(i + 1).padStart(2, "0")}`, w = ws.find((x) => day(x.start) === d)
                return <button key={d} onClick={() => w && route(`/workout/${w.id}`)} aria-label={D.fmt(d) + (w ? `, ${w.name}` : "")}
                  className={cn("grid aspect-square place-items-center rounded-full text-[15px] tabular-nums", days.has(d) && "bg-primary font-extrabold text-primary-foreground", d === t && "shadow-[inset_0_0_0_2px_var(--foreground)]", d > t && "opacity-25")}>{i + 1}</button>
              })}
            </div>
          </Card>
          <Kpis tinted items={[["Workouts", inMonth.length], ["Volume", fmtVol(inMonth.reduce((a, w) => a + volume(w), 0))], ["Time", fmtDur(inMonth.reduce((a, w) => a + (w.minutes || 0), 0))], ["Sets", inMonth.reduce((a, w) => a + setsOf(w), 0)]]} />
        </div>
        <div>
          <Label className="min-[1000px]:mt-0">{D.fmt(first, { month: "long" })}</Label>
          <div className="grid gap-2.5">{inMonth.length ? inMonth.map((w) => <WCard key={w.id} w={w} />) : <Card><Empty>No workouts this month.</Empty></Card>}</div>
        </div>
      </div>
    </Screen>
  )
}
function WCard({ w }: { w: Workout }) {
  const prs = prsOf(w).length
  return (
    <button onClick={() => route(`/workout/${w.id}`)} className="block w-full rounded-xl bg-card px-4 py-3.5 text-left active:bg-muted">
      <h3 className="flex items-baseline gap-1.5 text-[1.05rem] font-bold"><span className="min-w-0 flex-1 truncate">{w.name}</span><span className="text-sm font-semibold text-muted-foreground">{rel(day(w.start))}</span></h3>
      <div className="mt-1 mb-2 flex gap-4 text-sm text-muted-foreground"><b className="text-foreground tabular-nums">{fmtDur(w.minutes || 0)}</b><b className="text-foreground tabular-nums">{fmtVol(volume(w))}</b>
        {prs > 0 && <span className="inline-flex items-center gap-1 font-bold text-warm"><Trophy className="size-4" /> {prs} {prs === 1 ? "record" : "records"}</span>}</div>
      <div className="text-[15px] leading-relaxed">{w.exercises.map((e) => {
        const top = working(e.sets).reduce<any>((b, s) => ((s.kg || 0) > (b ? b.kg : -1) ? s : b), null)
        return <div key={e.ex} className="truncate">{working(e.sets).length} × {exById(e.ex).name} <span className="text-muted-foreground">{top ? `· ${top.kg ? fmtW(top.kg) + " × " : ""}${top.reps}` : ""}</span></div>
      })}</div>
    </button>
  )
}

export function WorkoutView({ id }: { id: string }) {
  const w = C("workouts").find((x) => x.id === id) as Workout | undefined
  if (!w) return <Screen><Top title="Workout" backTo="History" /><p className="text-muted-foreground">This workout was deleted.</p></Screen>
  const prs = prsOf(w), routine = routines().find((r) => r.id === w.routine)
  return (
    <Screen>
      <Top title={w.name} sub={D.fmt(day(w.start), { weekday: "long", day: "numeric", month: "long" })} backTo="History" />
      <Kpis tinted items={[["Duration", fmtDur(w.minutes || 0)], ["Volume", fmtVol(volume(w))], ["Sets", setsOf(w)], ["Records", prs.length]]} />
      {w.exercises.map((e) => {
        const ex = exById(e.ex), pr = prs.find((p) => p.ex === e.ex)
        return (
          <Card key={e.ex} className="mt-3">
            <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-1"><Glyph ex={ex} sm />
              <a href={`#/exercise/${e.ex}`} className="min-w-0 flex-1 truncate font-bold text-primary">{ex.name}</a>
              {pr && <span className="rounded bg-warm px-1.5 py-px text-[11px] font-extrabold text-white">PR</span>}</div>
            <div className="divide-y">{e.sets.map((s, i) => (
              <div key={i} className="flex min-h-10 items-center gap-3 px-3.5 py-1.5">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-muted text-sm font-extrabold">{setLabel(e.sets, i)}</span>
                <span className="flex-1 tabular-nums">{s.kg ? `${fmtW(s.kg)} ${unit()} × ` : ""}{s.reps}{s.rpe ? <span className="text-muted-foreground"> @ {s.rpe}</span> : ""}</span>
                <span className="text-sm text-muted-foreground tabular-nums">{s.kg && s.type !== "warmup" ? `${Math.round(toUnit(e1rm(s.kg, s.reps || 0)))} 1RM` : ""}</span>
              </div>
            ))}</div>
          </Card>
        )
      })}
      <div className="mt-4 grid gap-2.5">
        {routine && differsFromRoutine(w) && <Btn tone="tint" onClick={async () => { await updateRoutineFrom(w); toast.success(`${routine.name} updated`) }}><RefreshCw /> Update {routine.name} from this workout</Btn>}
        <Btn tone="tint" onClick={() => saveAsRoutine(w)}><Copy /> Save as a new routine</Btn>
        <Btn tone="danger" onClick={() => openSheet({ title: "Delete this workout?", body: () => <p className="text-muted-foreground">It's removed from your history, records and charts.</p>,
          foot: () => <><Btn onClick={closeSheet}>Keep</Btn><Btn className="bg-destructive text-white" onClick={async () => { await amber.store.collection("workouts").remove(w.id); closeSheet(); back() }}>Delete</Btn></> })}><Trash2 /> Delete workout</Btn>
      </div>
    </Screen>
  )
}
