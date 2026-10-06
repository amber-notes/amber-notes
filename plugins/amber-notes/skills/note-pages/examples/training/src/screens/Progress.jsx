import { useState } from "preact/hooks";
import { useSettings } from "amber";
import { Stat, Tabs, Card } from "amber-ui";
import ScreenHeader from "../components/ScreenHeader.jsx";
import WeightChart from "../components/WeightChart.jsx";
import { DEFAULTS, today, weight, useTraining } from "../data.js";

export default function Progress() {
  const { log } = useTraining();
  const [{ unit, goal }] = useSettings(DEFAULTS);
  const sets = log.items;
  const names = [...new Set(sets.map((s) => s.exercise))].slice(0, 3);
  const [pick, setPick] = useState(names[0]);

  const points = sets.filter((s) => s.exercise === pick).map((s) => ({ date: s.date, kg: s.weight }));
  const sessions = new Set(sets.map((s) => s.date)).size;
  const weeks = Math.max(1, Math.round((Date.parse(today()) - Date.parse(sets[0]?.date ?? today())) / 6048e5));
  return (
    <div class="screen">
      <ScreenHeader title="Progress" subtitle={`${sessions} sessions`} />
      <div class="stats">
        <Stat value={sessions} label="sessions" />
        <Stat value={(sessions / weeks).toFixed(1)} label={`a week, goal ${goal}`} />
        <Stat value={points.length ? weight(points[points.length - 1].kg, unit) : "–"} label={`${pick || ""} now`} />
      </div>
      <Tabs items={names} value={pick} onChange={setPick} label="Exercise" />
      <Card class="chart-card"><WeightChart points={points} label={`${pick} over time`} /></Card>
    </div>
  );
}
