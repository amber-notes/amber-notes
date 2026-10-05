import { useState } from "preact/hooks";
import { Stat, Tabs, Card, useNote, useData } from "amber-ui";
import ScreenHeader from "../components/ScreenHeader.jsx";
import WeightChart from "../components/WeightChart.jsx";
import { tables, today, prefs, weight } from "../data.js";

export default function Progress() {
  const note = useNote(), [data] = useData(), { log } = tables(note), p = prefs(data);
  const rows = log ? log.rows : [];
  const names = [...new Set(rows.map((r) => r[1]))].slice(0, 3);
  const [pick, setPick] = useState(names[0]);
  const points = rows.filter((r) => r[1] === pick).map((r) => ({ date: r[0], kg: +r[4] || 0 }));
  const sessions = new Set(rows.map((r) => r[0])).size;
  const weeks = Math.max(1, Math.round((Date.parse(today(note)) - Date.parse(rows[0] ? rows[0][0] : today(note))) / 6048e5));
  return (
    <div class="screen">
      <ScreenHeader title="Progress" subtitle={`${sessions} sessions`} />
      <div class="stats">
        <Stat value={sessions} label="sessions" />
        <Stat value={(sessions / weeks).toFixed(1)} label={`a week, goal ${p.goal}`} />
        <Stat value={points.length ? weight(points[points.length - 1].kg, p.unit) : "–"} label={`${pick || ""} now`} />
      </div>
      <Tabs items={names} value={pick} onChange={setPick} label="Exercise" />
      <Card class="chart-card"><WeightChart points={points} label={`${pick} over time`} /></Card>
    </div>
  );
}
