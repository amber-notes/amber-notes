import { useEffect } from "react"
import { Router, Route, route } from "amber-router"
import { setSummary, useAppData, useCollection } from "amber"
import { Toaster } from "@/components/ui/sonner"
import { SheetHost, Shell } from "@/components/kit"
import Home, { RoutineEdit } from "@/screens/home"
import Live, { Clock } from "@/screens/live"
import { Done, History, WorkoutView } from "@/screens/history"
import { ExerciseView, Library } from "@/screens/library"
import { Progress, Settings } from "@/screens/progress"
import { active, rel, day, workouts } from "@/lib/lift"

// The whole app re-renders when its data changes (here, on this device, or synced from another).
export default function App() {
  useAppData("active", null); useAppData("routines", []); useAppData("settings", {}); useAppData("custom", [])
  const done = useCollection("workouts"); useCollection("bodyweight")
  const a = active(), last = workouts()[0]
  useEffect(() => { setSummary(last ? `${done.items.length} workouts · last ${last.name}, ${rel(day(last.start)).toLowerCase()}` : "No workouts yet") }, [done.items.length, last?.id])
  const sets = a ? a.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0) : 0
  const resume = a && (
    <button onClick={() => route("/live")} className="flex w-full items-center gap-3 rounded-2xl bg-foreground py-2 pr-2 pl-4 text-left text-background shadow-xl">
      <span className="min-w-0 flex-1"><b className="block truncate">{a.name}</b><span className="text-sm opacity-80"><Clock start={a.start} /> · {sets} sets done</span></span>
      <span className="inline-flex min-h-9 items-center rounded-full bg-primary px-4 font-bold text-primary-foreground">Resume</span>
    </button>
  )
  return (
    <Shell title="Lifting" active={a} resume={resume}>
      <Router>
        <Route path="/" component={Home} default />
        <Route path="/live" component={Live} />
        <Route path="/done/:id" component={Done} />
        <Route path="/routine/:id" component={RoutineEdit} />
        <Route path="/history" component={History} />
        <Route path="/workout/:id" component={WorkoutView} />
        <Route path="/exercises" component={Library} />
        <Route path="/exercise/:id" component={ExerciseView} />
        <Route path="/progress" component={Progress} />
        <Route path="/settings" component={Settings} />
      </Router>
      <SheetHost />
      <Toaster position="top-center" />
    </Shell>
  )
}
