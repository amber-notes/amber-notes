import { useState } from "preact/hooks";
import { List, ListRow, Sheet, Input, Button, EmptyState, useNote, useData } from "amber-ui";
import ScreenHeader from "../components/ScreenHeader.jsx";
import { DAYS, tables, today, prefs, weight, lastSet, logSet } from "../data.js";

export default function Today() {
  const note = useNote(), [data] = useData(), { plan, log } = tables(note), unit = prefs(data).unit;
  const [logging, setLogging] = useState(null), [kg, setKg] = useState("");
  const day = DAYS[new Date(today(note) + "T12:00").getDay()];
  const row = plan && (plan.rows.find((r) => r[0] === day) || plan.rows[0]);
  if (!row) return <EmptyState title="No plan yet" body="Add a Plan table with Day, Workout and Exercises." />;
  const exercises = row[2].split(",").map((s) => s.trim());
  const done = (name) => log && log.rows.some((r) => r[0] === today(note) && r[1] === name);
  const open = (name) => { const l = lastSet(log, name); setKg(l ? l[4] : ""); setLogging(name); };
  const save = async () => { await logSet(note, log, logging, kg); setLogging(null); };

  return (
    <div class="screen">
      <ScreenHeader title="Today" subtitle={`${row[1]} · ${row[0] === day ? "today" : row[0]}`} />
      <List>
        {exercises.map((name) => {
          const l = lastSet(log, name);
          return (
            <ListRow title={name} subtitle={l ? `Last: ${l[2]} × ${l[3]} at ${weight(+l[4], unit)}` : "First time"}
              trailing={done(name) ? <span class="logged">Logged</span> : null}
              onClick={done(name) ? undefined : () => open(name)} />
          );
        })}
      </List>
      <Sheet open={!!logging} onClose={() => setLogging(null)} title={logging || ""}
        actions={<><Button variant="secondary" onClick={() => setLogging(null)}>Cancel</Button><Button onClick={save} disabled={!kg}>Log Set</Button></>}>
        <Input label="Weight (kg)" inputmode="decimal" value={kg} onInput={(e) => setKg(e.currentTarget.value)} hint="The same sets and reps as last time." />
      </Sheet>
    </div>
  );
}
