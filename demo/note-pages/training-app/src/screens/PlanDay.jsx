import { List, ListRow, useNote, useData } from "amber-ui";
import ScreenHeader from "../components/ScreenHeader.jsx";
import { tables, prefs, weight } from "../data.js";

export default function PlanDay({ day }) {
  const note = useNote(), [data] = useData(), { plan, log } = tables(note), unit = prefs(data).unit;
  const row = plan && plan.rows.find((r) => r[0] === day);
  const exercises = row ? row[2].split(",").map((s) => s.trim()) : [];
  const best = (name) => Math.max(0, ...(log ? log.rows.filter((r) => r[1] === name).map((r) => +r[4] || 0) : []));
  return (
    <div class="screen">
      <ScreenHeader title={row ? row[1] : day} subtitle={day} canGoBack />
      <List>
        {exercises.map((name) => <ListRow title={name} trailing={best(name) ? `Best ${weight(best(name), unit)}` : "Not yet"} />)}
      </List>
    </div>
  );
}
