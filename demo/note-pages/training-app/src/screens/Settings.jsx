import { List, ListRow, Tabs, useData } from "amber-ui";
import ScreenHeader from "../components/ScreenHeader.jsx";
import { prefs } from "../data.js";

// The app's own settings, kept in its data.
export default function Settings() {
  const [data, save] = useData(), p = prefs(data);
  const set = (patch) => save({ values: { prefs: { ...p, ...patch } } });
  return (
    <div class="screen">
      <ScreenHeader title="Settings" canGoBack />
      <List>
        <ListRow title="Units" trailing={<Tabs items={["kg", "lb"]} value={p.unit} onChange={(unit) => set({ unit })} label="Units" />} />
        <ListRow title="Sessions a week" subtitle="Your goal on Progress"
          trailing={<Tabs items={[2, 3, 4]} value={p.goal} onChange={(goal) => set({ goal })} label="Sessions a week" />} />
      </List>
    </div>
  );
}
