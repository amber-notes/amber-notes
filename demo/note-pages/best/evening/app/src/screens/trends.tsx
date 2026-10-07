// Trends: each rating over time, good-work share by week, habit runs, and what helped or hurt.
import { useState } from "react"
import { Bar, BarChart, CartesianGrid, Line, ComposedChart, ResponsiveContainer, Scatter, XAxis, YAxis } from "recharts"
import { Grid, PageHeader, Panel, Screen } from "@/components/calm"
import { cn } from "@/lib/utils"
import { useEvenings, usePlan, RATINGS, today, addDays, weekStart, weekStats, weekNumber, habitRuns, themes, logged, shortDate } from "@/lib/evening"

const COLORS: Record<string, string> = { energy: "var(--chart-1)", mood: "var(--chart-2)", focus: "var(--chart-3)", sleep: "var(--chart-4)" }
const RANGES = [["4w", "4 weeks", 28], ["12w", "12 weeks", 84], ["all", "All", 0]] as const
let saved = "4w"
const tick = { fill: "var(--muted-foreground)", fontSize: 11 }

export default function Trends() {
  const ev = useEvenings(), [plan] = usePlan(), t = today()
  const [range, setRange] = useState(saved)
  const all = Object.values(ev.byDate as Record<string, any>).filter(logged).sort((a, b) => a.date.localeCompare(b.date))
  const span = RANGES.find((r) => r[0] === range)![2] || Math.max(7, all.length ? Math.round((+new Date(t) - +new Date(all[0].date)) / 864e5) + 1 : 7)
  const dates = Array.from({ length: span }, (_, i) => addDays(t, i - span + 1)), recs = all.filter((d) => d.date >= dates[0])
  const weeks: string[] = []; for (let s = weekStart(dates[0]); s <= t; s = addDays(s, 7)) weeks.push(s)
  const good = weeks.map((s) => ({ week: `W${weekNumber(s)}`, pct: weekStats(ev, plan, s).goodPct }))

  // Each rating on its own: the evenings as faint dots, and a line through the last seven days' average.
  const rating = (k: string) => {
    const rows = dates.map((d) => {
      const win = Array.from({ length: 7 }, (_, j) => ev.byDate[addDays(d, -j)]).filter((r) => logged(r) && r[k] != null)
      return { date: shortDate(d), day: logged(ev.byDate[d]) ? ev.byDate[d][k] ?? null : null, avg: win.length >= 2 ? win.reduce((a, r) => a + r[k], 0) / win.length : null }
    })
    const recent = rows.map((r) => r.day).filter((v) => v != null).slice(-7) as number[]
    return { rows, avg: recent.length ? Math.round((recent.reduce((a, b) => a + b, 0) / recent.length) * 10) / 10 : null }
  }

  return (
    <Screen>
      <PageHeader kicker={`${recs.length} evenings logged`} title="Trends" right={
        <div role="tablist" className="mt-1 flex shrink-0 rounded-xl bg-secondary p-[3px]">
          {RANGES.map(([id, l]) => (
            <button key={id} role="tab" aria-selected={range === id} onClick={() => { saved = id; setRange(id) }}
              className={cn("min-h-8 rounded-[9px] px-2.5 text-[13px] font-semibold text-muted-foreground", range === id && "bg-card text-foreground shadow-sm")}>{l}</button>
          ))}
        </div>} />
      <Grid>
        {RATINGS.map(([k, label]) => {
          const r = rating(k)
          return (
            <Panel key={k} title={label} right={<span className="text-[13px] text-muted-foreground">last 7 · <b className="num text-lg" style={{ color: COLORS[k] }}>{r.avg ?? "–"}</b></span>}>
              <div className="h-[120px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={r.rows} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="date" tick={tick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={28} />
                    <YAxis domain={[1, 10]} ticks={[1, 5, 10]} tick={tick} tickLine={false} axisLine={false} width={22} />
                    <Scatter dataKey="day" fill={COLORS[k]} fillOpacity={0.3} isAnimationActive={false} shape={(p: any) => p.cy == null ? <g /> : <circle cx={p.cx} cy={p.cy} r={2.4} fill={COLORS[k]} fillOpacity={0.3} />} />
                    <Line dataKey="avg" type="monotone" stroke={COLORS[k]} strokeWidth={2.2} dot={false} connectNulls={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          )
        })}

        <Panel title="Good work" right={<span className="text-[13px] text-muted-foreground">share of hours, by week</span>}>
          <div className="h-[150px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={good} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="week" tick={tick} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis domain={[0, 100]} ticks={[0, 50, 100]} unit="%" tick={tick} tickLine={false} axisLine={false} width={38} />
                <Bar dataKey="pct" fill="var(--primary)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Habit runs" right={<span className="text-[13px] text-muted-foreground">now · best</span>}>
          {plan.habits.map((h: any) => {
            const r = habitRuns(ev, h, t)
            return (
              <div key={h.id} className="grid grid-cols-[minmax(0,8.5em)_minmax(0,1fr)_1.8em_1.8em] items-center gap-2.5 text-[15px]">
                <span className="truncate">{h.name}</span>
                <span className="h-2 overflow-hidden rounded-full bg-secondary"><i className="block h-full rounded-full bg-good" style={{ width: `${r.best ? (r.current / r.best) * 100 : 0}%` }} /></span>
                <b className="num text-right">{r.current}</b><span className="num text-right text-muted-foreground">{r.best}</span>
              </div>
            )
          })}
          <p className="text-[13px] text-muted-foreground">Counted on the days each habit is planned.</p>
        </Panel>

        <Themes title="What helped" items={themes(recs, "helped").slice(0, 6)} />
        <Themes title="What hurt" items={themes(recs, "hurt").slice(0, 6)} bad />
      </Grid>
    </Screen>
  )
}

function Themes({ title, items, bad }: { title: string; items: { text: string; n: number }[]; bad?: boolean }) {
  const top = items[0]?.n || 1
  return (
    <Panel title={title} right={<span className="text-[13px] text-muted-foreground">most often</span>}>
      {!items.length && <p className="text-muted-foreground">Nothing written yet.</p>}
      {items.map((x) => (
        <div key={x.text} className="grid grid-cols-[minmax(0,1fr)_30%_2.4em] items-center gap-2.5 text-[15px]">
          <span className="truncate">{x.text[0].toUpperCase() + x.text.slice(1)}</span>
          <span className="h-2 overflow-hidden rounded-full bg-secondary"><i className={cn("block h-full rounded-full", bad ? "bg-bad/70" : "bg-good")} style={{ width: `${(x.n / top) * 100}%` }} /></span>
          <b className="num text-right">{x.n}×</b>
        </div>
      ))}
    </Panel>
  )
}
