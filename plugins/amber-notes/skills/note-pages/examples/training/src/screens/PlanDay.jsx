import { useSettings } from "amber";
import { List, ListRow } from "amber-ui";
import ScreenHeader from "../components/ScreenHeader.jsx";
import { DEFAULTS, weight, useTraining } from "../data.js";

export default function PlanDay({ day: name }) {
  const { plan, log } = useTraining();
  const [{ unit }] = useSettings(DEFAULTS);
  const day = plan.find((d) => d.day === name);
  const best = (ex) => Math.max(0, ...log.items.filter((s) => s.exercise === ex).map((s) => s.weight));
  return (
    <div class="screen">
      <ScreenHeader title={day ? day.workout : name} subtitle={name} canGoBack />
      <List>
        {(day ? day.exercises : []).map((ex) => <ListRow title={ex} trailing={best(ex) ? `Best ${weight(best(ex), unit)}` : "Not yet"} />)}
      </List>
    </div>
  );
}
