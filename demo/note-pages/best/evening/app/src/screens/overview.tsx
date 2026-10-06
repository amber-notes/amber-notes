// What Evening opens on, every day: tonight, the plan for today, and the week so far at a glance.
import { useEffect, useState } from "react"
import { route } from "amber-router"
import { Check, ChevronRight, Flag, Flame, Pencil } from "lucide-react"
import { setSummary } from "@/lib/amber"
import { Grid, Marks, Meter, PageHeader, Panel, Screen, Spark } from "@/components/calm"
import { lastCheckIn } from "@/screens/check-in"
import { cn } from "@/lib/utils"
import { useEvenings, usePlan, RATINGS, DAY_SHORT, DAY_NAMES, today, addDays, weekday, weekStart, weekStats, weekNumber, streak, logged, longDate, fmtH, hoursFor } from "@/lib/evening"

const greet = () => { const h = new Date().getHours(); return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening" }
const LinkButton = ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
  <button onClick={onClick} className="inline-flex min-h-8 items-center gap-0.5 text-[15px] font-semibold text-primary-ink">{children}<ChevronRight className="size-4" /></button>
)

export default function Overview() {
  const ev = useEvenings(), [plan] = usePlan(), t = today(), tonight = ev.byDate[t], done = logged(tonight)
  const start = weekStart(t), w = weekStats(ev, plan, start), run = streak(ev.byDate, t)
  const [thanks, setThanks] = useState(lastCheckIn && lastCheckIn.date === t ? lastCheckIn : null)
  useEffect(() => { if (thanks) { const id = setTimeout(() => setThanks(null), 6000); return () => clearTimeout(id) } }, [thanks])
  useEffect(() => { setSummary(`${done ? "Logged tonight" : "Tonight not logged yet"} · ${fmtH(w.hours)} of ${w.target} h this week`) }, [done, w.hours, w.target])

  // The win to aim for: tonight's plan for tomorrow once it's logged, otherwise last night's for today.
  const plannedBy = done ? tonight : ev.byDate[addDays(t, -1)], aim = plannedBy?.tomorrow
  const elapsed = w.dates.filter((d) => d <= t)
  const pace = elapsed.reduce((a, d) => a + hoursFor(plan, d), 0) - (done ? 0 : hoursFor(plan, t))
  const last14 = Array.from({ length: 14 }, (_, i) => ev.byDate[addDays(t, i - 13)])

  return (
    <Screen>
      <PageHeader kicker={longDate(t)} title={greet()} right={run > 0 && (
        <div className="mt-0.5 flex shrink-0 items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1.5 text-sm text-primary-ink" title="Evenings logged in a row">
          <Flame className="size-[18px]" /><b className="num text-base">{run}</b>{run === 1 ? "evening" : "evenings"}
        </div>)} />
      {thanks && (
        <div role="status" className="flex animate-[rise_.32s_cubic-bezier(.34,1.4,.64,1)] items-center gap-2 rounded-2xl bg-good/12 px-3.5 py-2.5 text-[15px] font-semibold text-good">
          <Check className="size-[18px]" /> Logged in {thanks.seconds < 60 ? `${thanks.seconds} s` : `${Math.floor(thanks.seconds / 60)} min ${thanks.seconds % 60} s`}. Sleep well.
        </div>
      )}
      <Grid>
        {done ? (
          <Panel className="grid-cols-[minmax(0,1fr)_auto] items-center max-[360px]:grid-cols-1">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-[34px] shrink-0 place-items-center rounded-full bg-good text-white"><Check className="size-[18px]" /></span>
              <div className="min-w-0"><b className="block">Logged tonight</b><span className="text-sm text-muted-foreground">{tonightLine(tonight, plan)}</span></div>
            </div>
            <button onClick={() => route(`/log/${t}`)} className="inline-flex min-h-11 items-center gap-1.5 justify-self-start rounded-[14px] bg-secondary px-4 text-[15px] font-semibold"><Pencil className="size-4" /> Edit</button>
          </Panel>
        ) : (
          <Panel>
            <div><div className="kicker">Tonight</div><h2 className="mt-1.5 font-serif text-2xl leading-tight font-semibold">Two minutes, then rest.</h2>
              <p className="mt-2 text-[15px] text-muted-foreground">Hours, how the day felt, today's habits and tomorrow's win.</p></div>
            <button onClick={() => route(`/log/${t}`)} className="h-[58px] w-full rounded-[18px] bg-primary text-lg font-semibold text-primary-foreground transition active:scale-[.98]">Log today</button>
          </Panel>
        )}

        <Panel>
          <div className="kicker">{done ? `Tomorrow, ${DAY_NAMES[weekday(addDays(t, 1))]}` : "Today"}</div>
          {aim?.win ? <>
            <p className="font-serif text-xl leading-snug font-semibold">{aim.win}</p>
            {aim.outcomes?.length > 0 && <ol className="grid list-decimal gap-0.5 pl-5 text-[15.5px]">{aim.outcomes.map((o: string, i: number) => <li key={i}>{o}</li>)}</ol>}
            {aim.firstTask && <div className="flex items-center gap-2 text-[15px] font-semibold text-primary-ink"><Flag className="size-4 shrink-0" /><span>First: {aim.firstTask}</span></div>}
          </> : <p className="text-muted-foreground">{done ? "No win condition set for tomorrow." : "Set one tonight in the last step: a win condition, up to three outcomes and a first task."}</p>}
        </Panel>

        {weekday(t) === 0 && (
          <button onClick={() => route("/week")} className="flex items-center justify-between gap-3 rounded-[22px] bg-primary-soft p-[18px] text-left">
            <div><div className="kicker">Sunday</div><b>Review the week and set next week's hours</b></div><ChevronRight className="size-5 text-primary-ink" />
          </button>
        )}

        <Panel title="This week" right={<LinkButton onClick={() => route("/week")}>Week {weekNumber(t)}</LinkButton>}>
          <div className="flex items-baseline gap-1.5">
            <b className="num font-rounded text-[2.4rem] leading-none font-semibold tracking-[-.02em]">{fmtH(w.hours)}</b>
            <span className="text-muted-foreground">of {w.target} h</span>
            <em className="num ml-auto font-semibold text-primary-ink not-italic">{w.goodPct}% good</em>
          </div>
          <Meter good={w.good} total={w.hours} budget={w.target} pace={pace} />
          <div className="grid grid-cols-7 gap-[5px]">
            {w.dates.map((d) => {
              const r = ev.byDate[d], on = logged(r)
              return (
                <button key={d} disabled={d > t} onClick={() => route(`/log/${d}`)} aria-label={`${longDate(d)}${on ? `, ${fmtH(r.workHours)} hours` : ""}`}
                  className={cn("grid min-h-12 justify-items-center gap-0.5 rounded-xl pt-2 pb-1.5 text-xs text-muted-foreground",
                    d > t ? "shadow-[inset_0_0_0_1px_var(--border)]" : on ? "bg-primary-soft" : "bg-secondary", d === t && "shadow-[inset_0_0_0_2px_var(--primary)]")}>
                  <span>{DAY_SHORT[weekday(d)][0]}</span><b className={cn("num text-sm", on ? "text-primary-ink" : "text-foreground")}>{on ? fmtH(r.workHours) : d > t ? "" : "·"}</b>
                </button>
              )
            })}
          </div>
        </Panel>

        <Panel title="How you've felt" right={<span className="text-[13px] text-muted-foreground">two weeks · last 7</span>}>
          {RATINGS.map(([k, label]) => (
            <div key={k} className="grid grid-cols-[4.6em_minmax(0,1fr)_2.2em] items-center gap-2.5 text-[15px]">
              <span>{label.split(" ")[0]}</span><Spark values={last14.map((d) => (logged(d) ? d[k] ?? null : null))} /><b className="num text-right">{avg7(last14, k) ?? "–"}</b>
            </div>
          ))}
        </Panel>

        <Panel title="Habits this week" right={<LinkButton onClick={() => route("/trends")}>Streaks</LinkButton>}>
          {w.habits.map((h) => (
            <div key={h.id} className="grid min-h-7 grid-cols-[minmax(0,1fr)_auto_2.6em] items-center gap-2.5 text-[15px]">
              <span className="truncate">{h.name}</span><Marks marks={h.marks} dates={w.dates} today={t} /><b className="num text-right">{h.done}/{h.due}</b>
            </div>
          ))}
        </Panel>
      </Grid>
    </Screen>
  )
}

function avg7(days: any[], k: string) {
  const v = days.filter((d) => logged(d) && d[k] != null).slice(-7).map((d) => d[k])
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null
}

function tonightLine(d: any, plan: any) {
  const due = plan.habits.filter((h: any) => d.habits?.[h.id] && d.habits[h.id] !== "N/A"), yes = due.filter((h: any) => d.habits[h.id] === "Yes").length
  const r = RATINGS.map(([k, l]) => (d[k] != null ? `${l[0]}${d[k]}` : null)).filter(Boolean).join(" ")
  return [`${fmtH(d.workHours)} h, ${fmtH(d.goodWorkHours)} good`, r, due.length ? `${yes}/${due.length} habits` : null].filter(Boolean).join(" · ")
}
