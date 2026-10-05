// The note's Plan and Log tables, and the app's own preferences (kept in amber.data, not the note).
export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function tables(note) {
  return {
    plan: note.tables.find((t) => t.columns.some((c) => /exercises/i.test(c.name))),
    log: note.tables.find((t) => t.columns.some((c) => /weight/i.test(c.name))),
  };
}

export const today = (note) => note.today || new Date().toISOString().slice(0, 10);

export function prefs(data) {
  return { unit: "kg", goal: 3, ...(((data || {}).values || {}).prefs || {}) };
}

export function weight(kg, unit) {
  return unit === "lb" ? `${Math.round(kg * 2.2046)} lb` : `${kg} kg`;
}

export function lastSet(log, name) {
  return log && [...log.rows].reverse().find((r) => r[1] === name);
}

export function logSet(note, log, name, kg) {
  const last = lastSet(log, name);
  return window.amber.update({ op: "append_row", table: log.index,
    values: { Date: today(note), Exercise: name, Sets: last ? last[2] : "3", Reps: last ? last[3] : "8", Weight: String(kg) } });
}
