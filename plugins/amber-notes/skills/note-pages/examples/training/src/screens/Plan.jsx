import { useTable } from "amber";
import { List, ListRow } from "amber-ui";
import ScreenHeader from "../components/ScreenHeader.jsx";

export default function Plan() {
  const plan = useTable("Plan");
  return (
    <div class="screen">
      <ScreenHeader title="Plan" subtitle={`${plan.rows.length} sessions a week`} />
      <List>
        {plan.rows.map((d) => <ListRow title={`${d.Day} · ${d.Workout}`} subtitle={d.Exercises} href={`#/plan/${d.Day}`} />)}
      </List>
    </div>
  );
}
