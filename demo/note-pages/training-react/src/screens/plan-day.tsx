import { ArrowLeft, Trophy } from "lucide-react"
import { back } from "amber-router"
import { useSettings } from "@/lib/amber"
import { DEFAULTS, weight, useTraining } from "@/lib/training"
import { PageHeader } from "@/components/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

export default function PlanDay({ day: name }: { day: string }) {
  const { plan, sets } = useTraining()
  const [{ unit }] = useSettings(DEFAULTS)
  const day = plan.find((d) => d.day === name)
  const best = (ex: string) => Math.max(0, ...sets.filter((s) => s.exercise === ex).map((s) => s.weight))
  return (
    <>
      <PageHeader
        title={day?.workout ?? name}
        subtitle={name}
        back={<Button variant="secondary" size="icon" className="rounded-full" aria-label="Back" onClick={back}><ArrowLeft /></Button>}
      />
      <Card className="gap-0 py-0">
        {(day?.exercises ?? []).map((ex, i) => (
          <div key={ex} className={"flex items-center gap-3 px-4 py-3.5 " + (i ? "border-t" : "")}>
            <span className="flex-1 font-medium">{ex}</span>
            {best(ex) ? <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><Trophy className="size-4 text-primary" />{weight(best(ex), unit)}</span> : <span className="text-sm text-muted-foreground">Not yet</span>}
          </div>
        ))}
      </Card>
    </>
  )
}
