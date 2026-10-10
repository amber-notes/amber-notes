import { useState, useLayoutEffect } from "preact/hooks";
import { useSettings, setSummary } from "amber";
import { List, ListRow, Sheet, Input, Button, EmptyState } from "amber-ui";
import ScreenHeader from "../components/ScreenHeader.jsx";
import { DAYS, DEFAULTS, today, weight, lastSet, useTraining } from "../data.js";

export default function Today() {
  const { plan, log } = useTraining();
  const [{ unit }] = useSettings(DEFAULTS);
  const [logging, setLogging] = useState(null), [kg, setKg] = useState("");
  const date = today(), dayName = DAYS[new Date().getDay()];
  const day = plan.find((d) => d.day === dayName) || plan[0];

  // The line under "Training" in the note list.
  const sessions = new Set(log.items.map((s) => s.date)).size;
  useLayoutEffect(() => { if (sessions) setSummary(`${sessions} sessions, last on ${log.items[log.items.length - 1].date}`); }, [sessions]);

  if (!day) return <EmptyState title="No plan yet" body="Add the days you train in Plan." />;
  const done = (name) => log.items.some((s) => s.date === date && s.exercise === name);
  const open = (name) => { setKg(String(lastSet(log, name)?.weight ?? "")); setLogging(name); };
  const save = async () => {
    const last = lastSet(log, logging);
    await log.add({ date, exercise: logging, sets: last?.sets ?? 3, reps: last?.reps ?? 8, weight: +kg });
    setLogging(null);
  };

  return (
    <div class="screen">
      <ScreenHeader title="Today" subtitle={`${day.workout} · ${day.day === dayName ? "today" : day.day}`} />
      <List>
        {day.exercises.map((name) => {
          const last = lastSet(log, name);
          return (
            <ListRow title={name} subtitle={last ? `Last: ${last.sets} × ${last.reps} at ${weight(last.weight, unit)}` : "First time"}
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
