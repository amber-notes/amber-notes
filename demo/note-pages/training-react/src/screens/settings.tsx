import { ArrowLeft } from "lucide-react"
import { back } from "amber-router"
import { useSettings } from "@/lib/amber"
import { DEFAULTS } from "@/lib/training"
import { PageHeader } from "@/components/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

// The app's own settings, kept in its data.
export default function Settings() {
  const [settings, update] = useSettings(DEFAULTS)
  return (
    <>
      <PageHeader title="Settings" back={<Button variant="secondary" size="icon" className="rounded-full" aria-label="Back" onClick={back}><ArrowLeft /></Button>} />
      <Card className="gap-0 py-0">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <Label className="flex-1">Units</Label>
          <Tabs value={settings.unit} onValueChange={(unit) => update({ unit })}>
            <TabsList><TabsTrigger value="kg">kg</TabsTrigger><TabsTrigger value="lb">lb</TabsTrigger></TabsList>
          </Tabs>
        </div>
        <div className="flex items-center gap-3 border-t px-4 py-3.5">
          <Label className="flex-1">Sessions a week</Label>
          <Select value={String(settings.goal)} onValueChange={(g) => update({ goal: +g })}>
            <SelectTrigger className="w-24" aria-label="Sessions a week"><SelectValue /></SelectTrigger>
            <SelectContent>{[2, 3, 4, 5].map((g) => <SelectItem key={g} value={String(g)}>{g}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </Card>
    </>
  )
}
