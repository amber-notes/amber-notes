import { Settings as Gear } from "lucide-react"
import { route } from "amber-router"
import { Button } from "@/components/ui/button"

export function SettingsButton() {
  return (
    <Button variant="secondary" size="icon" className="rounded-full" aria-label="Settings" onClick={() => route("/settings")}>
      <Gear />
    </Button>
  )
}
