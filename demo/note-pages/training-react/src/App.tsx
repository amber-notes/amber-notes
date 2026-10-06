import { Router, Route } from "amber-router"
import { CalendarDays, Dumbbell, TrendingUp } from "lucide-react"
import { Toaster } from "@/components/ui/sonner"
import { AppShell } from "@/components/app-shell"
import Today from "@/screens/today"
import Plan from "@/screens/plan"
import PlanDay from "@/screens/plan-day"
import Progress from "@/screens/progress"
import Settings from "@/screens/settings"

const screens = [
  { path: "/", label: "Today", icon: Dumbbell },
  { path: "/plan", label: "Plan", icon: CalendarDays },
  { path: "/progress", label: "Progress", icon: TrendingUp },
]

export default function App() {
  return (
    <AppShell title="Training" screens={screens}>
      <div className="mx-auto max-w-5xl px-4 pt-4 min-[900px]:px-10 min-[900px]:pt-8">
        <Router>
          <Route path="/" component={Today} default />
          <Route path="/plan" component={Plan} />
          <Route path="/plan/:day" component={PlanDay} />
          <Route path="/progress" component={Progress} />
          <Route path="/settings" component={Settings} />
        </Router>
      </div>
      <Toaster position="top-center" />
    </AppShell>
  )
}
