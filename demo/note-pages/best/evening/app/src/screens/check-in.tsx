// Tonight's check-in: five short steps, one question per screen, then back to the Overview.
import { useLayoutEffect, useRef, useState } from "react"
import { route } from "amber-router"
import { ChevronLeft } from "lucide-react"
import { batch, device, useStore } from "@/lib/amber"
import { BigSwitch, Field, Scale, Stepper, YesNo } from "@/components/calm"
import { cn } from "@/lib/utils"
import { useEvenings, usePlan, RATINGS, DAY_NAMES, today, addDays, weekday, weekStart, weekDates, hoursFor, weekBudget, scheduled, logged, longDate } from "@/lib/evening"

const STEPS = ["work", "rate", "habits", "reflect", "tomorrow"] as const
export let lastCheckIn: { date: string; seconds: number } | null = null // for the Overview's thank-you line

function blank(plan: any, ev: any, date: string) {
  const prev = Object.values(ev.byDate as Record<string, any>).filter((d) => logged(d) && d.date < date && d.workHours > 0).sort((a, b) => a.date.localeCompare(b.date)).at(-1)
  const work = hoursFor(plan, date), ratio = prev ? prev.goodWorkHours / prev.workHours : 0.5
  return { workHours: work, goodWorkHours: Math.round(work * ratio * 2) / 2, energy: null, mood: null, focus: null, sleep: null, habits: {} as Record<string, string>,
    helped: "", hurt: "", notes: "", tomorrow: { win: "", outcomes: ["", "", ""], firstTask: "", alarmsSet: false } }
}

export default function CheckIn({ date = today() }: { date?: string }) {
  const ev = useEvenings(), [plan] = usePlan(), [reminder, setReminder] = useStore("reminder", null)
  const existing = ev.byDate[date]
  const [d, setD] = useState(() => {
    const b = blank(plan, ev, date)
    if (!existing) return b
    return { ...b, ...existing, habits: { ...existing.habits }, tomorrow: { ...b.tomorrow, ...(existing.tomorrow || {}), outcomes: [...(existing.tomorrow?.outcomes || []), "", "", ""].slice(0, 3) } }
  })
  const [step, setStep] = useState(0), [typing, setTyping] = useState(false)
  const started = useRef(Date.now())
  useLayoutEffect(() => { window.scrollTo(0, 0) }, [step])
  useLayoutEffect(() => {
    const field = (e: Event) => /INPUT|TEXTAREA/.test((e.target as HTMLElement).tagName)
    const on = (e: Event) => field(e) && setTyping(true), off = (e: Event) => field(e) && setTyping(false)
    document.addEventListener("focusin", on); document.addEventListener("focusout", off)
    return () => { document.removeEventListener("focusin", on); document.removeEventListener("focusout", off) }
  }, [])
  const put = (patch: any) => setD((x: any) => ({ ...x, ...patch }))
  const tom = (patch: any) => put({ tomorrow: { ...d.tomorrow, ...patch } })
  const habits = plan.habits.filter((h: any) => scheduled(h, date)), off = plan.habits.filter((h: any) => !scheduled(h, date))
  const isToday = date === today(), kind = STEPS[step]

  const record = () => {
    const h: Record<string, string> = {}
    for (const x of plan.habits) h[x.id] = scheduled(x, date) ? d.habits[x.id] || "" : "N/A"
    const { id, created, updated, ...rest } = d as any
    return { ...rest, habits: h, tomorrow: { ...d.tomorrow, outcomes: d.tomorrow.outcomes.map((o: string) => o.trim()).filter(Boolean) } }
  }
  const next = async () => {
    if (step < STEPS.length - 1) { setStep(step + 1); return }
    await batch(async () => { await ev.save(date, { ...record(), loggedAt: existing?.loggedAt || new Date().toISOString() }) })
    if (isToday && plan.remind) remindTomorrow(plan, date, reminder, setReminder)
    lastCheckIn = { date, seconds: Math.round((Date.now() - started.current) / 1000) }
    route("/")
  }

  // The week so far, with tonight's hours added as they change.
  const week = weekDates(weekStart(date)).filter((x) => x !== date).reduce((a, x) => a + (logged(ev.byDate[x]) ? +ev.byDate[x].workHours || 0 : 0), 0)
  const target = ev.weekOf(weekStart(date))?.target ?? weekBudget(plan), total = week + (d.workHours || 0)
  const pct = (v: number) => `${Math.min(100, (v / target) * 100)}%`
  const Title = ({ k, t, s }: { k: string; t: string; s?: string }) => (
    <div><div className="kicker">{k}</div><h1 className="mt-1.5 font-serif text-[1.95rem] leading-[1.12] font-semibold text-balance">{t}</h1>{s && <p className="mt-2 text-[15px] text-muted-foreground">{s}</p>}</div>
  )

  return (
    <div className="mx-auto flex min-h-screen max-w-[560px] flex-col">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center px-5 pt-2.5" style={{ paddingTop: "calc(10px + var(--amber-safe-top, 0px))" }}>
        <button className="min-h-8 justify-self-start text-[15px] text-muted-foreground" onClick={() => route("/")}>{logged(existing) ? "Close" : "Later"}</button>
        <div className="flex gap-1.5" aria-label={`Step ${step + 1} of 5`}>
          {STEPS.map((_, i) => <b key={i} className={cn("h-[5px] w-[22px] rounded-full transition-colors", i === step ? "bg-primary" : i < step ? "bg-mid" : "bg-border")} />)}
        </div>
        {step < 4 ? <button className="min-h-8 justify-self-end text-[15px] text-muted-foreground" onClick={next}>Skip</button> : <span />}
      </div>

      <div key={step} className="flex flex-1 animate-[rise_.28s_cubic-bezier(.34,1.4,.64,1)] flex-col gap-[22px] px-[22px] pt-[30px] pb-5">
        {kind === "work" && <>
          <Title k={`${isToday ? `${DAY_NAMES[weekday(date)]} evening` : longDate(date)} · 1 of 5`} t="How much did you work today?" s="Then the part that actually moved things." />
          <Stepper label="Work hours" value={d.workHours} onChange={(v) => put({ workHours: v, goodWorkHours: Math.min(d.goodWorkHours ?? 0, v) })} />
          <Stepper label="Good work hours" value={d.goodWorkHours} max={d.workHours ?? 24} onChange={(v) => put({ goodWorkHours: v })} />
          <div>
            <div className="flex h-2 overflow-hidden rounded-full bg-secondary"><i className="bg-primary" style={{ width: pct(week) }} /><i className="bg-mid" style={{ width: `calc(${pct(total)} - ${pct(week)})` }} /></div>
            <div className="num mt-2 flex justify-between text-sm text-muted-foreground">
              <span>This week {Math.round(total * 10) / 10} of {target} h</span><span>{d.workHours ? Math.round((d.goodWorkHours / d.workHours) * 100) : 0}% good today</span>
            </div>
          </div>
        </>}
        {kind === "rate" && <>
          <Title k="2 of 5" t="How was the day?" />
          {RATINGS.map(([k, label]) => <Scale key={k} label={label} value={(d as any)[k]} onChange={(v) => put({ [k]: v })} />)}
        </>}
        {kind === "habits" && <>
          <Title k={`3 of 5 · ${DAY_NAMES[weekday(date)]}'s habits`} t="What got done?" />
          {habits.map((h: any) => (
            <div key={h.id} className="card-calm flex items-center gap-3 rounded-[20px] py-3 pr-3 pl-[18px]">
              <div className="min-w-0 flex-1"><b className="block font-semibold">{h.name}</b>{h.detail && <span className="text-[13.5px] text-muted-foreground">{h.detail}</span>}</div>
              <YesNo label={h.name} value={d.habits[h.id]} onChange={(v) => put({ habits: { ...d.habits, [h.id]: v } })} />
            </div>
          ))}
          {off.length > 0 && <p className="text-center text-sm text-faint">{off.map((h: any) => h.name).join(" and ")} {off.length > 1 ? "are" : "is"} off today.</p>}
        </>}
        {kind === "reflect" && <>
          <Title k="4 of 5" t="What made the difference?" s="A few words each. Skip what's empty." />
          <Field multiline label="What helped today?" value={d.helped} placeholder="Early gym, phone in the other room" onChange={(v) => put({ helped: v })} />
          <Field multiline label="What hurt today?" value={d.hurt} placeholder="Late meeting ran over" onChange={(v) => put({ hurt: v })} />
          <Field multiline rows={2} label="Notes" value={d.notes} placeholder="Anything else worth remembering" onChange={(v) => put({ notes: v })} />
        </>}
        {kind === "tomorrow" && <>
          <Title k={`5 of 5 · ${DAY_NAMES[weekday(addDays(date, 1))]}`} t="Set up tomorrow" />
          <Field label="Win condition" value={d.tomorrow.win} placeholder="Tomorrow is a win if…" onChange={(v) => tom({ win: v })} />
          <div className="card-calm grid gap-1 px-[18px] pt-3 pb-1.5">
            <b className="text-xs font-bold tracking-[.06em] text-muted-foreground uppercase">Outcomes</b>
            {d.tomorrow.outcomes.map((o: string, i: number) => (
              <div key={i} className={cn("flex items-center gap-2.5 py-1", i > 0 && "border-t")}>
                <span className="num grid size-[22px] shrink-0 place-items-center rounded-full bg-secondary text-xs font-bold text-muted-foreground">{i + 1}</span>
                <input aria-label={`Outcome ${i + 1}`} value={o} placeholder={i === 0 ? "The one that matters most" : "Optional"} enterKeyHint="next"
                  onInput={(e) => { const os = [...d.tomorrow.outcomes]; os[i] = (e.target as HTMLInputElement).value; tom({ outcomes: os }) }}
                  className="min-h-[1.6em] w-full bg-transparent py-0.5 text-[17px] outline-none placeholder:text-faint" />
              </div>
            ))}
          </div>
          <Field label="First task" value={d.tomorrow.firstTask} placeholder="What you start with" onChange={(v) => tom({ firstTask: v })} />
          <label className="card-calm flex items-center justify-between gap-3 px-[18px] py-3.5 font-semibold">
            Alarms and timers set
            <BigSwitch checked={!!d.tomorrow.alarmsSet} onCheckedChange={(v) => tom({ alarmsSet: v })} aria-label="Alarms and timers set" />
          </label>
        </>}
      </div>

      {/* While typing, the buttons follow the fields instead of floating over them above the keyboard. */}
      <div className={cn("flex gap-2.5 px-5 pt-3", !typing && "sticky bottom-0 bg-linear-to-b from-transparent to-background to-30%")}
        style={{ paddingBottom: "calc(16px + max(var(--amber-safe-bottom, 0px), var(--amber-inset-bottom, 0px)))" }}>
        <button aria-label="Back" disabled={step === 0} onClick={() => setStep(step - 1)}
          className="grid size-[58px] shrink-0 place-items-center rounded-[18px] bg-secondary text-muted-foreground disabled:opacity-40"><ChevronLeft className="size-6" /></button>
        <button onClick={next} className="h-[58px] flex-1 rounded-[18px] bg-primary text-lg font-semibold text-primary-foreground transition active:scale-[.98]">{step === 4 ? "Finish" : "Next"}</button>
      </div>
    </div>
  )
}

// One reminder for tomorrow evening, replacing the last one.
async function remindTomorrow(plan: any, date: string, reminder: any, setReminder: (v: any) => void) {
  try {
    if (reminder?.id) await device.notify.cancel(reminder.id)
    const [hh, mm] = String(plan.remindAt || "21:30").split(":").map(Number), at = new Date(addDays(date, 1) + "T00:00:00")
    at.setHours(hh, mm)
    const r = await device.notify({ title: "Evening check-in", body: "Two minutes: hours, how it went, and tomorrow's win.", at: at.toISOString() })
    if (r && r.id) setReminder({ id: r.id, at: at.toISOString() })
  } catch { /* Notifications not allowed: the check-in still works. */ }
}
