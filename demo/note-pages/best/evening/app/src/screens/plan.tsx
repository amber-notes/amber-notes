// The plan: hours per weekday, which habit falls on which day, the review date and the reminder.
// Also where the spreadsheet's rows come in, and where everything goes out as CSV or JSON.
import { useState } from "react"
import { Minus, Plus, Share, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import { batch, share } from "@/lib/amber"
import { BigSwitch, Grid, PageHeader, Panel, RoundButton, Screen } from "@/components/calm"
import { cn } from "@/lib/utils"
import { useEvenings, usePlan, DAY_SHORT, DAY_NAMES, WEEK, weekBudget, toCSV, fromSheet, logged, today, parse } from "@/lib/evening"

const soft = "rounded-[10px] bg-secondary px-2.5 py-2 text-base outline-none"

export default function Plan() {
  const [plan, setPlan] = usePlan(), ev = useEvenings()
  const hours = (i: number, v: number) => { const h = [...plan.hours]; h[i] = Math.max(0, Math.min(16, v)); setPlan({ hours: h }) }
  const habit = (id: string, patch: any) => setPlan({ habits: plan.habits.map((h: any) => (h.id === id ? { ...h, ...patch } : h)) })
  const add = () => setPlan({ habits: [...plan.habits, { id: "habit-" + Date.now().toString(36), name: "New habit", days: [0, 1, 2, 3, 4, 5, 6], detail: "" }] })
  const left = Math.round((+parse(plan.reviewDate) - +parse(today())) / 864e5 / 7)

  return (
    <Screen>
      <PageHeader kicker="Plan" title="Hours and habits" sub="Optimise for good hours and real output, never borrowed from sleep." />
      <Grid>
        <Panel title="Work budget" right={<b className="num">{weekBudget(plan)} h a week</b>}>
          {WEEK.map((i) => (
            <div key={i} className="flex min-h-11 items-center gap-2.5">
              <span className="flex-1">{DAY_NAMES[i]}</span>
              <RoundButton className="size-10" aria-label={`${DAY_NAMES[i]}: less`} onClick={() => hours(i, plan.hours[i] - 1)}><Minus className="size-[18px]" /></RoundButton>
              <b className="num w-[3.2em] text-center">{plan.hours[i]} h</b>
              <RoundButton className="size-10" aria-label={`${DAY_NAMES[i]}: more`} onClick={() => hours(i, plan.hours[i] + 1)}><Plus className="size-[18px]" /></RoundButton>
            </div>
          ))}
          <p className="text-[13px] text-muted-foreground">Each Sunday's review can set a different budget for the week after.</p>
        </Panel>

        <Panel title="Habits" right={<button onClick={add} className="inline-flex min-h-8 items-center gap-1 text-[15px] font-semibold text-primary-ink"><Plus className="size-4" /> Add</button>}>
          {plan.habits.map((h: any) => (
            <div key={h.id} className="grid gap-1.5 border-t py-2.5">
              <div className="flex items-center gap-1.5">
                <input defaultValue={h.name} aria-label="Habit name" onChange={(e) => habit(h.id, { name: e.target.value.trim() || h.name })} className="min-w-0 flex-1 bg-transparent py-1 font-semibold outline-none" />
                <button aria-label={`Remove ${h.name}`} onClick={() => setPlan({ habits: plan.habits.filter((x: any) => x.id !== h.id) })} className="grid size-10 place-items-center rounded-xl text-faint"><Trash2 className="size-[18px]" /></button>
              </div>
              <input defaultValue={h.detail} placeholder="When, how long" aria-label={`${h.name}: detail`} onChange={(e) => habit(h.id, { detail: e.target.value })} className="bg-transparent py-0.5 text-sm text-muted-foreground outline-none placeholder:text-faint" />
              <div className="grid grid-cols-7 gap-1">
                {WEEK.map((i) => {
                  const on = h.days.includes(i)
                  return <button key={i} aria-pressed={on} aria-label={`${h.name} on ${DAY_NAMES[i]}`} onClick={() => habit(h.id, { days: on ? h.days.filter((x: number) => x !== i) : [...h.days, i].sort() })}
                    className={cn("h-9 rounded-[10px] text-[13px] font-semibold", on ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground")}>{DAY_SHORT[i].slice(0, 2)}</button>
                })}
              </div>
            </div>
          ))}
          <p className="text-[13px] text-muted-foreground">A habit doesn't show up in the check-in on days it isn't planned, and counts as N/A.</p>
        </Panel>

        <Panel title="Evening">
          <label className="flex min-h-11 items-center justify-between gap-3 font-semibold">Remind me to check in
            <BigSwitch checked={!!plan.remind} onCheckedChange={(v) => setPlan({ remind: v })} aria-label="Remind me to check in" />
          </label>
          {plan.remind && <label className="flex min-h-11 items-center gap-2.5"><span className="flex-1">At</span><input type="time" value={plan.remindAt} onChange={(e) => setPlan({ remindAt: e.target.value })} className={soft} /></label>}
          <label className="flex min-h-11 items-center gap-2.5"><span className="flex-1">Review the system on</span><input type="date" value={plan.reviewDate} onChange={(e) => setPlan({ reviewDate: e.target.value })} className={soft} /></label>
          {left > 0 && <p className="text-[13px] text-muted-foreground">{left} weeks to go. Don't optimise the tracker: optimise the work, health and sustainability.</p>}
        </Panel>

        <DataPanel plan={plan} setPlan={setPlan} ev={ev} />
      </Grid>
    </Screen>
  )
}

function DataPanel({ plan, setPlan, ev }: { plan: any; setPlan: (p: any) => void; ev: any }) {
  const [text, setText] = useState(""), [out, setOut] = useState<string | null>(null)
  const recs = Object.values(ev.byDate as Record<string, any>).filter(logged).sort((a, b) => a.date.localeCompare(b.date))
  const preview = text.trim() ? fromSheet(text, plan) : null
  const run = async () => {
    const { days, habits } = preview!
    const fresh = days.filter((d: any) => !logged(ev.byDate[d.date]))
    await batch(async () => {
      if (JSON.stringify(habits) !== JSON.stringify(plan.habits)) await setPlan({ habits })
      for (const d of fresh) await ev.save(d.date, d)
    })
    toast.success(`Brought in ${fresh.length} ${fresh.length === 1 ? "day" : "days"}`)
    setText("")
  }
  // The share sheet on the iPhone, a Save panel on the Mac; the text itself below if neither works.
  const send = async (kind: "csv" | "json") => {
    const strip = ({ id, created, updated, ...x }: any) => x
    const text = kind === "csv" ? toCSV(plan, recs) : JSON.stringify({ plan, days: recs.map(strip), weeks: ev.weeks.items.map(strip) }, null, 1)
    try {
      const r: any = await share({ name: `evening-${today()}.${kind}`, type: kind === "csv" ? "text/csv" : "application/json", text })
      if (r && r.ok === false) throw new Error(r.error)
      setOut(null)
    } catch { setOut(text); toast("Couldn't open the share sheet. The text is below to copy.") }
  }
  const btn = "inline-flex min-h-11 flex-auto items-center justify-center gap-1.5 rounded-[14px] px-4 text-[15px] font-semibold"
  return (
    <Panel title="Your data" right={<span className="num text-[13px] text-muted-foreground">{recs.length} days</span>}>
      <p className="text-[13px] text-muted-foreground">From the spreadsheet: in Daily Tracker, select all, copy, and paste here. A CSV export works too. Days already logged here are kept as they are.</p>
      <textarea rows={3} value={text} placeholder="Paste rows from the spreadsheet" onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        className="w-full resize-y rounded-[14px] bg-secondary px-3 py-2.5 text-base outline-none placeholder:text-faint" />
      <div className="flex flex-wrap gap-2">
        <label className={cn(btn, "cursor-pointer bg-secondary")}><Upload className="size-[18px]" /> CSV file
          <input type="file" accept=".csv,.tsv,.txt,text/csv" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()) }} /></label>
        <button disabled={!preview?.days.length} onClick={run} className={cn(btn, "bg-primary text-primary-foreground disabled:opacity-45")}>
          {preview ? `Bring in ${preview.days.length} ${preview.days.length === 1 ? "day" : "days"}` : "Bring in"}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => send("csv")} className={cn(btn, "bg-secondary")}><Share className="size-[18px]" /> Export CSV</button>
        <button onClick={() => send("json")} className={cn(btn, "bg-secondary")}><Share className="size-[18px]" /> Export JSON</button>
      </div>
      {out && <textarea readOnly rows={5} value={out} onFocus={(e) => e.target.select()} className="w-full rounded-[14px] bg-secondary px-3 py-2.5 font-mono text-xs outline-none" />}
    </Panel>
  )
}
