import { List, ListRow, useNote } from "amber-ui";
import ScreenHeader from "../components/ScreenHeader.jsx";
import { tables } from "../data.js";

export default function Plan() {
  const note = useNote(), { plan } = tables(note), rows = plan ? plan.rows : [];
  return (
    <div class="screen">
      <ScreenHeader title="Plan" subtitle={`${rows.length} sessions a week`} />
      <List>
        {rows.map((r) => <ListRow title={`${r[0]} · ${r[1]}`} subtitle={r[2]} href={`#/plan/${r[0]}`} />)}
      </List>
    </div>
  );
}
