import { useState } from "preact/hooks";
import { useNote, useTable, useSettings } from "amber";
import { Stat, Tabs, Card } from "amber-ui";
import ScreenHeader from "../components/ScreenHeader.jsx";
import WeightChart from "../components/WeightChart.jsx";
import { DEFAULTS, weight } from "../data.js";

export default function Progress() {
  const { today } = useNote();
  const log = useTable("Log");
  const [{ unit, goal }] = useSettings(DEFAULTS);
  const names = [...new Set(log.rows.map((r) => r.Exercise))].slice(0, 3);
  const [pick, setPick] = useState(names[0]);

  const points = log.rows.filter((r) => r.Exercise === pick).map((r) => ({ date: r.Date, kg: +r.Weight || 0 }));
  const sessions = new Set(log.rows.map((r) => r.Date)).size;
  const first = log.rows[0]?.Date ?? today;
  const weeks = Math.max(1, Math.round((Date.parse(today) - Date.parse(first)) / 6048e5));
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
