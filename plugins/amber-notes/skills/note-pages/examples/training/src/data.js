// Small helpers. The note's tables come from useTable("Plan") and useTable("Log").
export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DEFAULTS = { unit: "kg", goal: 3 };

export const weight = (kg, unit) => unit === "lb" ? `${Math.round(kg * 2.2046)} lb` : `${kg} kg`;
export const exercisesOf = (day) => (day ? day.Exercises.split(",").map((s) => s.trim()) : []);
export const lastSet = (log, name) => [...log.rows].reverse().find((r) => r.Exercise === name);
