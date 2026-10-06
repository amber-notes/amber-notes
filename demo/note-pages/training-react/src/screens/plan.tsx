import { CalendarDays, ChevronRight } from "lucide-react"
import { useTraining } from "@/lib/training"
import { PageHeader } from "@/components/app-shell"
import { SettingsButton } from "@/screens/settings-button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"

export default function Plan() {
  const { plan } = useTraining()
  return (
    <>
      <PageHeader title="Plan" subtitle={`${plan.length} sessions a week`} action={<SettingsButton />} />
      <div className="grid gap-3 min-[900px]:grid-cols-3">
        {plan.map((d) => (
          <a key={d.day} href={`#/plan/${d.day}`}>
            <Card className="gap-2 px-4 py-4">
              <div className="flex items-center gap-2">
                <CalendarDays className="size-4 text-primary" />
                <span className="font-medium">{d.day}</span>
                <Badge variant="secondary">{d.workout}</Badge>
                <ChevronRight className="ml-auto size-4 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">{d.exercises.join(", ")}</p>
            </Card>
          </a>
        ))}
      </div>
    </>
  )
}
