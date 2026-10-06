import { Router, Route } from "amber-router"
import { Toaster } from "@/components/ui/sonner"
import { AppShell } from "@/components/calm"
import Overview from "@/screens/overview"
import CheckIn from "@/screens/check-in"
import Week from "@/screens/week"
import Trends from "@/screens/trends"
import Plan from "@/screens/plan"

// Evening opens on the Overview, every day; the check-in is a screen of its own without tabs.
export default function App() {
  return (
    <AppShell>
      <Router>
        <Route path="/" component={Overview} default />
        <Route path="/log/:date" component={CheckIn} />
        <Route path="/week" component={Week} />
        <Route path="/trends" component={Trends} />
        <Route path="/plan" component={Plan} />
      </Router>
      <Toaster position="top-center" />
    </AppShell>
  )
}
