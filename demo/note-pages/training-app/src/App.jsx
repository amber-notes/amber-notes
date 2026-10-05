import { Router } from "amber-router";
import { Shell, Icon } from "amber-ui";
import Today from "./screens/Today.jsx";
import Plan from "./screens/Plan.jsx";
import PlanDay from "./screens/PlanDay.jsx";
import Progress from "./screens/Progress.jsx";
import Settings from "./screens/Settings.jsx";

const screens = [
  { path: "/", label: "Today", icon: <Icon name="clock" /> },
  { path: "/plan", label: "Plan", icon: <Icon name="calendar" /> },
  { path: "/progress", label: "Progress", icon: <Icon name="chart" /> },
];

export default function App() {
  return (
    <Shell items={screens} title="Training">
      <Router>
        <Today path="/" default />
        <Plan path="/plan" />
        <PlanDay path="/plan/:day" />
        <Progress path="/progress" />
        <Settings path="/settings" />
      </Router>
    </Shell>
  );
}
