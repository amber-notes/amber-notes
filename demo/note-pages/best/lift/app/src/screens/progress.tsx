// Progress: sets per muscle this week, volume per week, recent records, bodyweight.
// Settings: units, rest, RPE, the plate calculator, and export.
import { useState } from "react"
import { amber, share } from "amber"
import { FileJson, FileSpreadsheet } from "lucide-react"
import { toast } from "sonner"
import { Bars, Btn, Card, Chips, Empty, Field, Glyph, Label, LineTrend, List, Screen, Top, closeSheet, inputCls, openSheet } from "@/components/kit"
import { Switch } from "@/components/ui/switch"
import {
  C, D, day, everythingJSON, exById, fmtRest, fmtW, fromUnit, MCOLOR, parseNum, prsOf, rel, S, saveSettings, today, toUnit, unit, volume, working, workouts, workoutsCSV,
} from "@/lib/lift"

export function Progress() {
  const ws = workouts(), t = today(), wk0 = D.add(t, -D.wd(t)), thisWeek = ws.filter((w) => day(w.start) >= wk0)
  const sets: Record<string, number> = {}
  for (const w of thisWeek) for (const e of w.exercises) { const x = exById(e.ex), n = working(e.sets).length; sets[x.muscle] = (sets[x.muscle] || 0) + n; for (const o of x.other) sets[o] = (sets[o] || 0) + n / 2 }
  const muscles = Object.entries(sets).sort((a, b) => b[1] - a[1]), mx = Math.max(1, ...muscles.map((m) => m[1]))
  const weeks = Array.from({ length: 10 }, (_, k) => { const s = D.add(wk0, -7 * (9 - k)); return { v: toUnit(ws.filter((w) => day(w.start) >= s && day(w.start) < D.add(s, 7)).reduce((a, w) => a + volume(w), 0)) / 1000, label: D.fmt(s, { day: "numeric", month: "short" }), dim: k === 9 } })
  const recent: { ex: string; kind: string; value: string; date: string }[] = []
  for (const w of ws.slice(0, 12)) for (const p of prsOf(w)) recent.push({ ...p, date: day(w.start) })
  const bw = C("bodyweight").slice().sort((a, b) => a.date.localeCompare(b.date))
  return (
    <Screen wide>
      <Top title="Progress" sub={`This week: ${thisWeek.length} ${thisWeek.length === 1 ? "workout" : "workouts"}`} />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-6 min-[1000px]:grid-cols-2">
        <div>
          <Label className="mt-1">Sets per muscle this week</Label>
          <Card className="py-2">{muscles.length ? muscles.map(([m, n]) => (
            <div key={m} className="grid grid-cols-[6.2rem_minmax(0,1fr)_2.2rem] items-center gap-2.5 px-4 py-1.5 text-[15px]" style={{ "--mc": `var(${MCOLOR[m]})` } as React.CSSProperties}>
              <span>{m}</span><i className="block h-2.5 overflow-hidden rounded-full bg-muted"><b className="block h-full rounded-full bg-(--mc)" style={{ width: `${(n / mx) * 100}%` }} /></i><span className="text-right text-muted-foreground tabular-nums">{Math.round(n)}</span>
            </div>)) : <Empty>No sets yet this week.</Empty>}</Card>
          <p className="mx-0.5 mt-1.5 text-sm text-muted-foreground">Counts the main muscle fully and the others at half.</p>
          <Label>Volume per week</Label>
          <Card className="px-3 pt-3 pb-2"><Bars points={weeks} fmt={(v) => `${Math.round(v)} t`} /></Card>
        </div>
        <div>
          <Label className="mt-1">Recent records</Label>
          <List>{recent.length ? recent.slice(0, 8).map((p, i) => (
            <a key={i} href={`#/exercise/${p.ex}`} className="flex min-h-14 items-center gap-3 px-4 py-2 active:bg-muted"><Glyph ex={p.ex} sm />
              <span className="min-w-0 flex-1"><b className="block truncate">{exById(p.ex).name}</b><span className="text-sm text-muted-foreground">{p.kind} · {rel(p.date, t)}</span></span><b className="tabular-nums">{p.value}</b></a>
          )) : <Empty>Records show up as you beat them.</Empty>}</List>
          <Label><span className="flex-1">Bodyweight</span><button onClick={addWeight}>Add</button></Label>
          <Card className="px-4 pt-3.5 pb-2">{bw.length ? <>
            <div className="mb-1 flex flex-wrap items-baseline gap-2"><b className="font-[ui-rounded] text-[2rem] font-extrabold tabular-nums">{fmtW(bw.at(-1)!.kg)} {unit()}</b>
              {bw.length > 1 && <span className="text-sm text-muted-foreground">{bw.at(-1)!.kg - bw[0].kg > 0 ? "+" : "−"}{fmtW(Math.abs(bw.at(-1)!.kg - bw[0].kg))} since {D.fmt(bw[0].date, { day: "numeric", month: "short" })}</span>}</div>
            <LineTrend height={140} points={bw.map((b) => ({ v: toUnit(b.kg), label: D.fmt(b.date, { day: "numeric", month: "short" }) }))} />
          </> : <Empty>Log your weight now and then to see the trend.</Empty>}</Card>
        </div>
      </div>
    </Screen>
  )
}
function addWeight() {
  let v = ""
  openSheet({ title: "Bodyweight", body: () => <Field label={`Today, in ${unit()}`}><input inputMode="decimal" autoFocus onInput={(e) => (v = (e.target as HTMLInputElement).value)} className={inputCls + " min-h-14 text-center text-2xl tabular-nums"} /></Field>,
    foot: () => <Btn tone="primary" onClick={async () => { const n = parseNum(v); if (!n) return; await amber.store.collection("bodyweight").add({ date: today(), kg: Math.round(fromUnit(n) * 10) / 10 }); closeSheet(); toast.success("Bodyweight saved") }}>Save</Btn> })
}

const PCOL: Record<string, string> = { 25: "#C62828", 20: "#1E5BB8", 15: "#D9A400", 10: "#2E7D32", 5: "#555", 2.5: "#888", 1.25: "#aaa", 0.5: "#bbb" }
export function Settings() {
  const s = S(), [target, setTarget] = useState(100)
  const plates = (() => {
    let side = (fromUnit(target) - s.bar) / 2; const out: number[] = []; if (side < 0) return null
    for (const p of [...s.plates].sort((a, b) => b - a)) while (side >= p - 1e-6) { out.push(p); side -= p }
    return { out, left: Math.round(side * 2 * 100) / 100 }
  })()
  const row = (label: string, help: string, control: React.ReactNode) => (
    <div className="flex min-h-14 flex-wrap items-center gap-3 px-4 py-2.5"><span className="min-w-0 flex-1">{label}{help && <div className="text-sm text-muted-foreground">{help}</div>}</span>{control}</div>
  )
  const sel = (key: string, opts: [string | number, string][]) => (
    <select aria-label={key} value={String((s as any)[key])} onChange={(e) => saveSettings({ [key]: isNaN(+e.target.value) ? e.target.value : +e.target.value })} className="min-h-10 min-w-32 rounded-lg bg-muted px-2.5">
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
  )
  const tog = (key: string) => <Switch aria-label={key} checked={!!(s as any)[key]} onCheckedChange={(v) => saveSettings({ [key]: v })} className="h-7 w-12 [&_[data-slot=switch-thumb]]:size-6 [&_[data-slot=switch-thumb][data-state=checked]]:translate-x-[20px] data-[state=checked]:bg-ok" />
  const plate = (p: number, k: number) => <i key={k} className="grid w-[1.05rem] place-items-center rounded-[3px] text-[9px] font-extrabold text-white not-italic [writing-mode:vertical-rl]" style={{ height: `${2.2 + p * 0.18}rem`, background: PCOL[p] || "#777" }}>{fmtW(p)}</i>
  const exportAs = async (kind: "csv" | "json") => {
    const n = workouts().length
    try {
      const r: any = await share(kind === "csv" ? { name: `lift-workouts-${today()}.csv`, type: "text/csv", text: workoutsCSV() } : { name: `lift-${today()}.json`, type: "application/json", text: everythingJSON() })
      if (r && r.ok === false) throw new Error(r.error)
      toast.success(kind === "csv" ? `${n} workouts, one row per set` : "Everything, as JSON")
    } catch (e: any) { toast.error(`Couldn't export: ${e?.message || "the share sheet didn't open"}`) }
  }
  return (
    <Screen>
      <Top title="Settings" />
      <List>
        {row("Units", "", sel("unit", [["kg", "Kilograms"], ["lb", "Pounds"]]))}
        {row("Rest between sets", "Each exercise can have its own.", sel("rest", [60, 90, 120, 150, 180, 240].map((v) => [v, fmtRest(v)])))}
        {row("Rest after warm-up sets", "", sel("restWarmup", [30, 45, 60, 90].map((v) => [v, fmtRest(v)])))}
        {row("Notify when rest is over", "Even with the phone locked.", tog("notify"))}
        {row("Show RPE", "Rate of perceived exertion, per set.", tog("showRpe"))}
      </List>
      <Label>Plate calculator</Label>
      <Card className="px-4 py-4">
        <Field label={`Weight on the bar (${unit()})`}><input inputMode="decimal" value={target} onInput={(e) => setTarget(parseNum((e.target as HTMLInputElement).value) || 0)} className={inputCls + " text-center text-[1.4rem] tabular-nums"} /></Field>
        {plates ? <>
          <div className="mt-3 mb-1.5 flex h-28 items-center justify-center gap-[3px]" aria-label={`Each side: ${plates.out.map(fmtW).join(", ") || "nothing"}`}>
            {plates.out.slice().reverse().map(plate)}<span className="h-4 w-2 rounded-sm bg-muted-foreground" /><span className="h-3 w-12 rounded-sm bg-muted-foreground" /><span className="h-4 w-2 rounded-sm bg-muted-foreground" />{plates.out.map(plate)}
          </div>
          <p className="text-center text-sm text-muted-foreground">Each side: {plates.out.length ? plates.out.map(fmtW).join(" + ") : "just the bar"}{plates.left ? ` · ${fmtW(plates.left)} ${unit()} can't be made` : ""}</p>
        </> : <p className="mt-2.5 text-sm text-muted-foreground">Less than the bar.</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2.5"><span className="text-sm text-muted-foreground">Bar</span>{sel("bar", [[20, "20 kg"], [15, "15 kg"], [10, "10 kg"]])}</div>
        <div className="mt-2.5"><span className="text-sm text-muted-foreground">Plates you have</span>
          <div role="group" aria-label="Plates you have" className="mt-1.5 flex flex-wrap gap-1.5">{[25, 20, 15, 10, 5, 2.5, 1.25, 0.5].map((p) => (
            <button key={p} aria-pressed={s.plates.includes(p)} onClick={() => saveSettings({ plates: s.plates.includes(p) ? s.plates.filter((x: number) => x !== p) : [...s.plates, p] })}
              className="min-h-9 rounded-full bg-muted px-3.5 text-[15px] font-semibold text-muted-foreground aria-pressed:bg-foreground aria-pressed:text-background">{fmtW(p)}</button>
          ))}</div></div>
      </Card>
      <Label>Your data</Label>
      <Card className="grid gap-2.5 p-4">
        <p className="text-sm text-muted-foreground">Routines, the library and every set are kept with this note's app, encrypted and synced, where your AI can read them. Take a copy out any time.</p>
        <div className="flex flex-wrap gap-2 [&>*]:flex-1">
          <Btn onClick={() => exportAs("csv")}><FileSpreadsheet /> Export CSV</Btn>
          <Btn onClick={() => exportAs("json")}><FileJson /> Export JSON</Btn>
        </div>
      </Card>
    </Screen>
  )
}
