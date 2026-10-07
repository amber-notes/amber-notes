// Exercises: the library with search and filters, and one exercise with its chart, records,
// rep maxes and history.
import { useState } from "react"
import { route } from "amber-router"
import { ChartColumn, ChevronRight, Plus, Search } from "lucide-react"
import { Card, Chips, Empty, Glyph, Label, List, LineTrend, Round, Screen, Seg, Top, inputCls } from "@/components/kit"
import { customExercise } from "@/screens/picker"
import { EQUIPMENT, MUSCLES } from "@/lib/exercises"
import { allExercises, D, day, exById, fmtVol, fmtW, records, repMaxes, setText, toUnit, unit, V, workouts } from "@/lib/lift"

export function Library() {
  const [q, setQ] = useState(""), [m, setM] = useState("All"), [eq, setEq] = useState("All")
  const counts: Record<string, number> = {}
  for (const w of workouts()) for (const e of w.exercises) counts[e.ex] = (counts[e.ex] || 0) + 1
  const list = allExercises().filter((x) => (m === "All" || x.muscle === m || x.other.includes(m)) && (eq === "All" || x.equipment === eq) && (!q || x.name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0) || a.name.localeCompare(b.name))
  return (
    <Screen wide>
      <Top title="Exercises" sub={`${allExercises().length} exercises · ${(V().custom || []).length} of your own`}>
        <Round className="bg-primary text-primary-foreground" onClick={() => customExercise("", (id) => route(`/exercise/${id}`))} aria-label="New exercise"><Plus /></Round>
      </Top>
      <div className="relative"><Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input type="search" placeholder="Search" aria-label="Search exercises" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} className={inputCls + " pl-9"} /></div>
      <div className="mt-2.5"><Chips label="Muscle" value={m} options={["All", ...MUSCLES]} onChange={setM} /></div>
      <Chips label="Equipment" value={eq} options={["All", ...EQUIPMENT]} onChange={setEq} render={(x) => (x === "All" ? "Any equipment" : x)} />
      <div className="overflow-hidden rounded-xl bg-card min-[1000px]:grid min-[1000px]:grid-cols-2 [&>*]:border-t first:[&>*]:border-t-0 min-[1000px]:[&>*:nth-child(2)]:border-t-0 min-[1000px]:[&>*:nth-child(even)]:border-l">
        {list.map((x) => (
          <a key={x.id} href={`#/exercise/${x.id}`} className="flex min-h-[3.6rem] items-center gap-3 px-4 py-2 active:bg-muted">
            <Glyph ex={x} /><span className="min-w-0 flex-1"><b className="block truncate font-semibold">{x.name}</b>
              <span className="text-[13px] text-muted-foreground">{x.muscle}{x.other.length ? ` · ${x.other.slice(0, 2).join(", ")}` : ""} · {x.equipment}</span></span>
            {counts[x.id] ? <span className="text-sm text-muted-foreground tabular-nums">{counts[x.id]}×</span> : null}
            <ChevronRight className="size-4 text-muted-foreground/60" />
          </a>
        ))}
        {!list.length && <Empty>Nothing matches.</Empty>}
      </div>
    </Screen>
  )
}

const k0 = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10).replace(".", ","))
export function ExerciseView({ id }: { id: string }) {
  const ex = exById(id), r = records(id), [metric, setMetric] = useState<"e1rm" | "weight" | "vol">("e1rm"), [tab, setTab] = useState<"records" | "reps">("records")
  const pts = r.sessions.slice(-16).map((s) => ({ v: toUnit(metric === "e1rm" ? s.e1rm : metric === "weight" ? s.weight : s.vol), label: D.fmt(s.date, { day: "numeric", month: "short" }) }))
  const hist = workouts().filter((w) => w.exercises.some((e) => e.ex === id)).slice(0, 8)
  const rm = repMaxes(id)
  return (
    <Screen wide>
      <Top title={ex.name} sub={`${ex.muscle}${ex.other.length ? ` · ${ex.other.join(", ")}` : ""} · ${ex.equipment}`} backTo="Back" />
      {r.sessions.length ? (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-6 min-[1000px]:grid-cols-2">
          <div>
            <Card className="px-4 pt-4 pb-3">
              <Seg label="Chart" value={metric} onChange={setMetric} options={[["e1rm", "Est. 1RM"], ["weight", "Heaviest"], ["vol", "Volume"]]} />
              <div className="mt-3 mb-2 flex flex-wrap items-baseline gap-2"><b className="font-[ui-rounded] text-[2rem] font-extrabold tracking-tight tabular-nums">{pts.length ? k0(pts.at(-1)!.v) : "–"} {unit()}</b>
                <span className="text-sm text-muted-foreground">last time · {r.sessions.length} sessions</span></div>
              <LineTrend points={pts} />
            </Card>
            <Label><Seg label="Records" value={tab} onChange={setTab} options={[["records", "Records"], ["reps", "Rep maxes"]]} /></Label>
            {tab === "records" ? (
              <div className="grid grid-cols-2 gap-2">
                {[["Heaviest weight", `${fmtW(r.weight)} ${unit()}`], ["Best est. 1RM", `${Math.round(toUnit(r.e1rm))} ${unit()}`], ["Best set volume", fmtVol(r.setVol)], ["Most reps", String(r.reps)]].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-card px-3.5 py-3"><span className="text-xs font-semibold text-muted-foreground">{k}</span><b className="block font-[ui-rounded] text-[1.3rem] font-extrabold tabular-nums">{v}</b></div>
                ))}
              </div>
            ) : (
              <List aria-label="Rep maxes">
                <div className="grid grid-cols-[4.5rem_1fr_auto] px-4 py-2 text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase"><span>Reps</span><span>Best weight</span><span>When</span></div>
                {rm.map((x) => (
                  <a key={x.reps} href={`#/workout/${x.wid}`} className="grid min-h-11 grid-cols-[4.5rem_1fr_auto] items-center px-4 tabular-nums active:bg-muted">
                    <b>{x.reps} {x.reps === 1 ? "rep" : "reps"}</b><span><b>{fmtW(x.kg)} {unit()}</b>{!x.exact && <span className="text-sm text-muted-foreground"> (done for more)</span>}</span>
                    <span className="text-sm text-muted-foreground">{D.fmt(x.date, { day: "numeric", month: "short" })}</span>
                  </a>
                ))}
              </List>
            )}
          </div>
          <div>
            <Label className="min-[1000px]:mt-0">History</Label>
            <List>{hist.map((w) => {
              const e = w.exercises.find((x) => x.ex === id)!
              return (
                <a key={w.id} href={`#/workout/${w.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2 active:bg-muted">
                  <span className="min-w-0 flex-1"><b>{D.fmt(day(w.start), { weekday: "short", day: "numeric", month: "short" })}</b><div className="text-sm text-muted-foreground">{e.sets.map((s) => setText(s, ex)).join(" · ")}</div></span>
                  <ChevronRight className="size-4 text-muted-foreground/60" />
                </a>
              )
            })}</List>
          </div>
        </div>
      ) : <Card><Empty icon={ChartColumn} title="Not done yet">Do it in a workout and its history, records and charts show here.</Empty></Card>}
    </Screen>
  )
}
