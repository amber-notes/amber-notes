import { useTable, useSettings } from "amber";
import { List, ListRow } from "amber-ui";
import ScreenHeader from "../components/ScreenHeader.jsx";
import { DEFAULTS, weight, exercisesOf } from "../data.js";

export default function PlanDay({ day: name }) {
  const plan = useTable("Plan"), log = useTable("Log");
  const [{ unit }] = useSettings(DEFAULTS);
  const day = plan.rows.find((r) => r.Day === name);
  const best = (ex) => Math.max(0, ...log.rows.filter((r) => r.Exercise === ex).map((r) => +r.Weight || 0));
  return (
    <div class="screen">
      <ScreenHeader title={day ? day.Workout : name} subtitle={name} canGoBack />
      <List>
        {exercisesOf(day).map((ex) => <ListRow title={ex} trailing={best(ex) ? `Best ${weight(best(ex), unit)}` : "Not yet"} />)}
      </List>
    </div>
  );
}
