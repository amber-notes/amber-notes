// The Sunday review: the week against its budget, how it felt, habits done of scheduled, a note,
// and next week's hours. Any week can be opened, and any day of it filled in.
import { useState } from "react"
import { route } from "amber-router"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis } from "recharts"
import { Grid, Marks, Meter, PageHeader, Panel, RoundButton, Screen, Stepper } from "@/components/calm"
import { useEvenings, usePlan, RATINGS, DAY_NAMES, today, addDays, weekday, weekStart, weekStats, weekNumber, weekBudget, logged, shortDate, fmtH } from "@/lib/evening"

let shown: string | null = null // the week on screen, kept while switching tabs

export default function Week() {
  const ev = useEvenings(), [plan] = usePlan(), t = today(), thisWeek = weekStart(t)
  const [start, setStart] = useState(shown || thisWeek)
  const go = (s: string) => { shown = s; setStart(s) }
  const w = weekStats(ev, plan, start), next = addDays(start, 7), nextTarget = ev.weekOf(next)?.target ?? weekBudget(plan)
  const [note, setNote] = useState<{ start: string; text: string } | null>(null)
  const shownNote = note && note.start === start ? note.text : w.note
  const saveNote = (text: string) => { setNote({ start, text }); ev.saveWeek(start, { note: text }) }
  const bars = Array.from({ length: 10 }, (_, i) => addDays(thisWeek, (i - 9) * 7)).map((s) => {
    const x = weekStats(ev, plan, s); return { week: `W${weekNumber(s)}`, good: x.good, rest: Math.max(0, x.hours - x.good), target: x.target }
  })
  const left = w.target - w.hours

  return (
    <Screen>
      <PageHeader kicker={`Week ${weekNumber(start)}`} title={start === thisWeek ? "This week" : `${shortDate(start)} to ${shortDate(addDays(start, 6))}`}
        right={<div className="mt-1 flex shrink-0 gap-1.5">
          <RoundButton className="size-10" aria-label="Week before" onClick={() => go(addDays(start, -7))}><ChevronLeft className="size-[18px]" /></RoundButton>
          <RoundButton className="size-10" aria-label="Week after" disabled={start >= thisWeek} onClick={() => go(addDays(start, 7))}><ChevronRight className="size-[18px]" /></RoundButton>
        </div>} />
      <Grid>
        <Panel>
          <div className="flex items-baseline gap-1.5">
            <b className="num font-rounded text-[2.4rem] leading-none font-semibold tracking-[-.02em]">{fmtH(w.hours)}</b>
            <span className="text-muted-foreground">of {w.target} h</span>
            <em className="num ml-auto font-semibold text-primary-ink not-italic">{w.goodPct}% good</em>
          </div>
          <Meter good={w.good} total={w.hours} budget={w.target} />
          <div className="num flex justify-between gap-2.5 text-sm text-muted-foreground">
            <span>{fmtH(w.good)} good hours</span>
            <span>{left <= 0 ? `${fmtH(-left)} h over budget` : start === thisWeek ? `${fmtH(left)} h left this week` : `${fmtH(left)} h under budget`}</span>
          </div>
          <div className="grid grid-cols-4 gap-2 border-t pt-3 text-center">
            {RATINGS.map(([k, l]) => <div key={k}><b className="num block font-rounded text-[1.35rem] font-semibold">{w.averages[k] ?? "–"}</b><span className="text-xs text-muted-foreground">{l.split(" ")[0]}</span></div>)}
          </div>
        </Panel>

        <Panel title="Habits" right={<span className="text-[13px] text-muted-foreground">done of scheduled</span>}>
          {w.habits.filter((h) => h.due).map((h) => (
            <div key={h.id} className="grid min-h-7 grid-cols-[minmax(0,1fr)_auto_2.6em] items-center gap-2.5 text-[15px]">
              <span className="truncate">{h.name}</span><Marks marks={h.marks} dates={w.dates} today={t} /><b className="num text-right">{h.done}/{h.due}</b>
            </div>
          ))}
        </Panel>

        <Panel title="Days" className="gap-0">
          <div className="mt-1.5">
            {w.dates.map((d) => {
              const r = ev.byDate[d], on = logged(r)
              return (
                <button key={d} disabled={d > t} onClick={() => route(`/log/${d}`)}
                  className="grid min-h-12 w-full grid-cols-[4.2em_minmax(0,1fr)_auto] items-center gap-2.5 border-t py-2 text-left text-faint">
                  <span><b className="block text-[15px] text-foreground">{DAY_NAMES[weekday(d)].slice(0, 3)}</b><span className="text-xs text-muted-foreground">{shortDate(d)}</span></span>
                  <span className="truncate text-sm text-muted-foreground">
                    {on ? <><b className="num text-foreground">{fmtH(r.workHours)} h</b> · {fmtH(r.goodWorkHours)} good{r.helped ? <span className="text-primary-ink"> · {r.helped}</span> : ""}</>
                      : d > t ? "" : <span className="text-primary-ink">Not logged · fill in</span>}
                  </span>
                  {d <= t && <ChevronRight className="size-4" />}
                </button>
              )
            })}
          </div>
        </Panel>

        <Panel>
          <label className="grid gap-1 rounded-[18px] bg-secondary px-4 pt-3 pb-2.5">
            <b className="text-xs font-bold tracking-[.06em] text-muted-foreground uppercase">Week note</b>
            <textarea rows={3} value={shownNote} placeholder="What to keep, what to change next week" onInput={(e) => saveNote((e.target as HTMLTextAreaElement).value)}
              className="field-sizing-content min-h-[4.5em] w-full resize-none bg-transparent text-[17px] outline-none placeholder:text-faint" />
          </label>
          {start >= addDays(thisWeek, -7) && (
            <Stepper compact label={`Budget for week ${weekNumber(next)}`} value={nextTarget} step={1} max={100} unit="h" hint="Never borrowed from sleep" onChange={(v) => ev.saveWeek(next, { target: v })} />
          )}
        </Panel>

        <Panel title="Budget and actual" right={<span className="text-[13px] text-muted-foreground">10 weeks · good hours darker</span>} className="md:col-span-2">
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={bars} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="week" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} width={26} />
                <Bar dataKey="good" stackId="h" fill="var(--primary)" isAnimationActive={false} />
                <Bar dataKey="rest" stackId="h" fill="var(--mid)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Line dataKey="target" type="stepAfter" stroke="var(--foreground)" strokeOpacity={0.45} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </Grid>
    </Screen>
  )
}
