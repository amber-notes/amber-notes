// Training's data is JSON in the app's own store:
//   plan: [{ day: "Mon", workout: "Upper", exercises: ["Bench press", ...] }]
//   log (a collection): { id, date, exercise, sets, reps, weight }
// The first time, it starts from the tables the note held before it became an app.
import { useStore, useCollection, useImported, batch } from "amber";

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DEFAULTS = { unit: "kg", goal: 3 };
export const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD, local
export const weight = (kg, unit) => unit === "lb" ? `${Math.round(kg * 2.2046)} lb` : `${kg} kg`;
export const lastSet = (log, name) => [...log.items].reverse().find((s) => s.exercise === name);

let importing = false;

export function useTraining() {
  const [plan, setPlan] = useStore("plan", null);
  const log = useCollection("log");
  const imported = useImported();
  if (plan === null && imported && !importing) {
    importing = true;
    const t = imported.tables || {};
    batch(async () => {
      setPlan((t.Plan || []).map((r) => ({ day: r.Day, workout: r.Workout, exercises: r.Exercises.split(",").map((s) => s.trim()) })));
      for (const r of t.Log || []) log.add({ date: r.Date, exercise: r.Exercise, sets: +r.Sets, reps: +r.Reps, weight: +r.Weight });
    });
  }
  return { plan: plan || [], log };
}
