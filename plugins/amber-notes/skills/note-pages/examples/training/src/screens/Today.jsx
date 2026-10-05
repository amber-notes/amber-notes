import { useState } from "preact/hooks";
import { useNote, useTable, useSettings } from "amber";
import { List, ListRow, Sheet, Input, Button, EmptyState } from "amber-ui";
import ScreenHeader from "../components/ScreenHeader.jsx";
import { DAYS, DEFAULTS, weight, exercisesOf, lastSet } from "../data.js";

export default function Today() {
  const { today } = useNote();
  const plan = useTable("Plan"), log = useTable("Log");
  const [{ unit }] = useSettings(DEFAULTS);
  const [logging, setLogging] = useState(null), [kg, setKg] = useState("");

  const dayName = DAYS[new Date(today + "T12:00").getDay()];
  const day = plan.rows.find((r) => r.Day === dayName) || plan.rows[0];
  if (!day) return <EmptyState title="No plan yet" body="Add a Plan table with Day, Workout and Exercises." />;
  const done = (name) => log.rows.some((r) => r.Date === today && r.Exercise === name);

  const open = (name) => { setKg(lastSet(log, name)?.Weight ?? ""); setLogging(name); };
  const save = async () => {
    const last = lastSet(log, logging);
    await log.add({ Date: today, Exercise: logging, Sets: last?.Sets ?? "3", Reps: last?.Reps ?? "8", Weight: kg });
    setLogging(null);
  };

  return (
    <div class="screen">
      <ScreenHeader title="Today" subtitle={`${day.Workout} · ${day.Day === dayName ? "today" : day.Day}`} />
      <List>
        {exercisesOf(day).map((name) => {
          const last = lastSet(log, name);
          return (
            <ListRow title={name} subtitle={last ? `Last: ${last.Sets} × ${last.Reps} at ${weight(+last.Weight, unit)}` : "First time"}
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
