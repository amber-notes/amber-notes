// Training's data is JSON in the app's store:
//   plan: [{ day: "Mon", workout: "Upper", exercises: ["Bench press", ...] }]
//   log (a collection): { id, date, exercise, sets, reps, weight }
// The first time, it starts from the tables the note held before it became an app.
import { useStore, useCollection, useImported, batch } from "@/lib/amber"

export type Day = { day: string; workout: string; exercises: string[] }
export type Set = { id: string; date: string; exercise: string; sets: number; reps: number; weight: number }

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
export const DEFAULTS = { unit: "kg" as "kg" | "lb", goal: 3 }
export const today = () => new Date().toLocaleDateString("sv-SE")
export const weight = (kg: number, unit: string) => (unit === "lb" ? `${Math.round(kg * 2.2046)} lb` : `${kg} kg`)

let importing = false

export function useTraining() {
  const [plan, setPlan] = useStore<Day[] | null>("plan", null)
  const log = useCollection<Set>("log")
  const imported = useImported()
  if (plan === null && imported && !importing) {
    importing = true
    const t = imported.tables ?? {}
    batch(async () => {
      setPlan((t.Plan ?? []).map((r: any) => ({ day: r.Day, workout: r.Workout, exercises: r.Exercises.split(",").map((s: string) => s.trim()) })))
      for (const r of t.Log ?? []) log.add({ date: r.Date, exercise: r.Exercise, sets: +r.Sets, reps: +r.Reps, weight: +r.Weight })
    })
  }
  const sets = log.items as Set[]
  const lastSet = (name: string) => [...sets].reverse().find((s) => s.exercise === name)
  return { plan: plan ?? [], sets, log, lastSet }
}
