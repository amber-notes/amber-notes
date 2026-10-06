import { List, ListRow } from "amber-ui";
import ScreenHeader from "../components/ScreenHeader.jsx";
import { useTraining } from "../data.js";

export default function Plan() {
  const { plan } = useTraining();
  return (
    <div class="screen">
      <ScreenHeader title="Plan" subtitle={`${plan.length} sessions a week`} />
      <List>
        {plan.map((d) => <ListRow title={`${d.day} · ${d.workout}`} subtitle={d.exercises.join(", ")} href={`#/plan/${d.day}`} />)}
      </List>
    </div>
  );
}
