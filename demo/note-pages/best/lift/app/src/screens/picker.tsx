// Picking exercises: search, a muscle filter, several at once (or one, to replace), or a new one.
import { useState } from "react"
import { Plus, Search } from "lucide-react"
import { amber } from "amber"
import { Btn, Chips, Field, Glyph, closeSheet, inputCls, openSheet } from "@/components/kit"
import { EQUIPMENT, MUSCLES } from "@/lib/exercises"
import { allExercises, uid, V, workouts } from "@/lib/lift"

let chosen: string[] = [], redrawFoot = () => {}

function PickBody({ single, onPick }: { single?: boolean; onPick: (ids: string[]) => void }) {
  const [q, setQ] = useState(""), [muscle, setMuscle] = useState("All"), [, re] = useState(0)
  const used = new Set(workouts().slice(0, 30).flatMap((w) => w.exercises.map((e) => e.ex)))
  const list = allExercises().filter((x) => (muscle === "All" || x.muscle === muscle) && (!q || x.name.toLowerCase().includes(q.toLowerCase())))
    .sort((x, y) => (+used.has(y.id) - +used.has(x.id)) || x.name.localeCompare(y.name))
  return <>
    <div className="relative"><Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <input type="search" placeholder="Search exercises" aria-label="Search exercises" onInput={(e) => setQ((e.target as HTMLInputElement).value)} className={inputCls + " pl-9"} /></div>
    <div className="mt-2.5"><Chips label="Muscle" value={muscle} options={["All", ...MUSCLES]} onChange={setMuscle} /></div>
    <div className="divide-y overflow-hidden rounded-xl bg-card">
      {list.map((x) => (
        <label key={x.id} className="flex min-h-14 items-center gap-3 px-3.5 py-2">
          <Glyph ex={x} sm /><span className="min-w-0 flex-1"><b className="block truncate font-semibold">{x.name}</b><span className="text-[13px] text-muted-foreground">{x.muscle} · {x.equipment}{used.has(x.id) ? " · recent" : ""}</span></span>
          <input type={single ? "radio" : "checkbox"} name="pick" defaultChecked={chosen.includes(x.id)} aria-label={`Choose ${x.name}`} className="size-[1.35rem] shrink-0 accent-(--primary)"
            onChange={(e) => { chosen = single ? [x.id] : e.target.checked ? [...chosen, x.id] : chosen.filter((y) => y !== x.id); re((n) => n + 1); redrawFoot() }} />
        </label>
      ))}
      {!list.length && <div className="grid justify-items-center gap-3 p-6 text-muted-foreground"><p>No exercise called “{q}”.</p>
        <Btn tone="tint" onClick={() => { closeSheet(); setTimeout(() => customExercise(q, (id) => onPick([id])), 60) }}><Plus /> Create “{q}”</Btn></div>}
    </div>
  </>
}
function PickFoot({ single, onPick }: { single?: boolean; onPick: (ids: string[]) => void }) {
  const [, re] = useState(0); redrawFoot = () => re((n) => n + 1)
  return <>
    <Btn onClick={() => { closeSheet(); setTimeout(() => customExercise("", (id) => onPick([id])), 60) }}><Plus /> New</Btn>
    <Btn tone="primary" disabled={!chosen.length} onClick={() => { onPick(chosen); closeSheet() }}>{single ? "Replace" : chosen.length ? `Add ${chosen.length}` : "Add"}</Btn>
  </>
}
export function pickExercises(onPick: (ids: string[]) => void, { single }: { single?: boolean } = {}) {
  chosen = []
  openSheet({ title: single ? "Replace with" : "Add exercises", wide: true, body: () => <PickBody single={single} onPick={onPick} />, foot: () => <PickFoot single={single} onPick={onPick} /> })
}

export function customExercise(name: string, done?: (id: string) => void) {
  const v = { name, muscle: "Chest", equipment: "Barbell" }
  openSheet({ title: "New exercise", body: () => (
    <div className="grid gap-3.5">
      <Field label="Name"><input className={inputCls} defaultValue={name} autoFocus onInput={(e) => (v.name = (e.target as HTMLInputElement).value)} /></Field>
      <Field label="Main muscle"><select className={inputCls} onChange={(e) => (v.muscle = e.target.value)}>{MUSCLES.map((m) => <option key={m}>{m}</option>)}</select></Field>
      <Field label="Equipment"><select className={inputCls} onChange={(e) => (v.equipment = e.target.value)}>{EQUIPMENT.map((m) => <option key={m}>{m}</option>)}</select></Field>
    </div>
  ), foot: () => <Btn tone="primary" onClick={async () => {
    if (!v.name.trim()) return
    const id = "custom-" + uid()
    await amber.setData({ values: { custom: [...(V().custom || []), { id, name: v.name.trim(), muscle: v.muscle, other: [], equipment: v.equipment }] } })
    closeSheet(); done?.(id)
  }}>Save exercise</Btn> })
}
