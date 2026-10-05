import { useEffect, useState } from "react"
import { Check, ChevronRight, Dumbbell } from "lucide-react"
import { toast } from "sonner"
import { setSummary, useSettings } from "@/lib/amber"
import { DAYS, DEFAULTS, today, weight, useTraining } from "@/lib/training"
import { PageHeader } from "@/components/app-shell"
import { SettingsButton } from "@/screens/settings-button"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"

export default function Today() {
  const { plan, sets, log, lastSet } = useTraining()
  const [{ unit }] = useSettings(DEFAULTS)
  const [logging, setLogging] = useState<string | null>(null)
  const [kg, setKg] = useState("")
  const date = today()
  const dayName = DAYS[new Date().getDay()]
  const day = plan.find((d) => d.day === dayName) ?? plan[0]

  const sessions = new Set(sets.map((s) => s.date)).size
  useEffect(() => { if (sessions) setSummary(`${sessions} sessions, last on ${sets[sets.length - 1].date}`) }, [sessions])

  if (!day) return <PageHeader title="Today" subtitle="Add the days you train in Plan." />
  const done = (name: string) => sets.some((s) => s.date === date && s.exercise === name)
  const open = (name: string) => { setKg(String(lastSet(name)?.weight ?? "")); setLogging(name) }
  const save = async () => {
    const last = lastSet(logging!)
    await log.add({ date, exercise: logging!, sets: last?.sets ?? 3, reps: last?.reps ?? 8, weight: +kg })
    toast.success(`${logging} logged`)
    setLogging(null)
  }

  return (
    <>
      <PageHeader title="Today" subtitle={`${day.workout} · ${day.day === dayName ? "today" : day.day}`} action={<SettingsButton />} />
      <Card className="gap-0 py-0">
        {day.exercises.map((name, i) => {
          const last = lastSet(name)
          return (
            <button
              key={name}
              disabled={done(name)}
              onClick={() => open(name)}
              className={"flex w-full items-center gap-3 px-4 py-3.5 text-left " + (i ? "border-t" : "")}
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                {done(name) ? <Check className="size-4" /> : <Dumbbell className="size-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{name}</span>
                <span className="block text-sm text-muted-foreground">
                  {last ? `Last: ${last.sets} × ${last.reps} at ${weight(last.weight, unit)}` : "First time"}
                </span>
              </span>
              {done(name) ? <span className="text-sm font-medium text-primary">Logged</span> : <ChevronRight className="size-4 text-muted-foreground" />}
            </button>
          )
        })}
      </Card>

      <Sheet open={!!logging} onOpenChange={(o) => !o && setLogging(null)}>
        <SheetContent side="bottom" className="rounded-t-2xl" style={{ paddingBottom: "max(16px, var(--amber-safe-bottom))" }}>
          <SheetHeader>
            <SheetTitle>{logging}</SheetTitle>
            <SheetDescription>The same sets and reps as last time.</SheetDescription>
          </SheetHeader>
          <div className="grid gap-2 px-4">
            <Label htmlFor="kg">Weight (kg)</Label>
            <Input id="kg" inputMode="decimal" value={kg} onInput={(e) => setKg((e.target as HTMLInputElement).value)} autoFocus />
          </div>
          <SheetFooter className="flex-row">
            <Button variant="secondary" className="flex-1" onClick={() => setLogging(null)}>Cancel</Button>
            <Button className="flex-1" disabled={!kg} onClick={save}>Log Set</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}
