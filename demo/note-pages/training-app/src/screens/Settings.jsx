import { useSettings } from "amber";
import { List, ListRow, Tabs } from "amber-ui";
import ScreenHeader from "../components/ScreenHeader.jsx";
import { DEFAULTS } from "../data.js";

// The app's own settings, kept in its data.
export default function Settings() {
  const [settings, update] = useSettings(DEFAULTS);
  return (
    <div class="screen">
      <ScreenHeader title="Settings" canGoBack />
      <List>
        <ListRow title="Units" trailing={<Tabs items={["kg", "lb"]} value={settings.unit} onChange={(unit) => update({ unit })} label="Units" />} />
        <ListRow title="Sessions a week" subtitle="Your goal on Progress"
          trailing={<Tabs items={[2, 3, 4]} value={settings.goal} onChange={(goal) => update({ goal })} label="Sessions a week" />} />
      </List>
    </div>
  );
}
