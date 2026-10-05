// Makes the demo's note.md and data.json: nine weeks of push / pull / legs, written relative to today.
import fs from "node:fs";
const NAMES = {"bench-press": "Bench Press", "incline-bench-press": "Incline Bench Press", "decline-bench-press": "Decline Bench Press", "db-bench-press": "Dumbbell Bench Press", "incline-db-press": "Incline Dumbbell Press", "db-fly": "Dumbbell Fly", "cable-fly": "Cable Fly", "pec-deck": "Pec Deck", "chest-press-machine": "Chest Press Machine", "push-up": "Push-up", "dip": "Dip", "deadlift": "Deadlift", "romanian-deadlift": "Romanian Deadlift", "db-romanian-deadlift": "Dumbbell Romanian Deadlift", "barbell-row": "Barbell Row", "pendlay-row": "Pendlay Row", "db-row": "One-arm Dumbbell Row", "seated-cable-row": "Seated Cable Row", "lat-pulldown": "Lat Pulldown", "close-grip-pulldown": "Close-grip Pulldown", "pull-up": "Pull-up", "chin-up": "Chin-up", "assisted-pull-up": "Assisted Pull-up", "t-bar-row": "T-bar Row", "chest-supported-row": "Chest-supported Row", "face-pull": "Face Pull", "straight-arm-pulldown": "Straight-arm Pulldown", "back-extension": "Back Extension", "good-morning": "Good Morning", "shrug": "Barbell Shrug", "db-shrug": "Dumbbell Shrug", "overhead-press": "Overhead Press", "seated-db-press": "Seated Dumbbell Press", "arnold-press": "Arnold Press", "shoulder-press-machine": "Shoulder Press Machine", "lateral-raise": "Lateral Raise", "cable-lateral-raise": "Cable Lateral Raise", "front-raise": "Front Raise", "rear-delt-fly": "Rear Delt Fly", "reverse-pec-deck": "Reverse Pec Deck", "upright-row": "Upright Row", "push-press": "Push Press", "barbell-curl": "Barbell Curl", "ez-bar-curl": "EZ-bar Curl", "db-curl": "Dumbbell Curl", "hammer-curl": "Hammer Curl", "incline-db-curl": "Incline Dumbbell Curl", "preacher-curl": "Preacher Curl", "cable-curl": "Cable Curl", "concentration-curl": "Concentration Curl", "triceps-pushdown": "Triceps Pushdown", "rope-pushdown": "Rope Pushdown", "overhead-triceps-extension": "Overhead Triceps Extension", "skull-crusher": "Skull Crusher", "close-grip-bench": "Close-grip Bench Press", "db-kickback": "Dumbbell Kickback", "bench-dip": "Bench Dip", "wrist-curl": "Wrist Curl", "reverse-curl": "Reverse Curl", "farmers-carry": "Farmer's Carry", "back-squat": "Back Squat", "front-squat": "Front Squat", "goblet-squat": "Goblet Squat", "hack-squat": "Hack Squat", "leg-press": "Leg Press", "leg-extension": "Leg Extension", "bulgarian-split-squat": "Bulgarian Split Squat", "walking-lunge": "Walking Lunge", "reverse-lunge": "Reverse Lunge", "step-up": "Step-up", "pistol-squat": "Pistol Squat", "leg-curl": "Lying Leg Curl", "seated-leg-curl": "Seated Leg Curl", "nordic-curl": "Nordic Curl", "hip-thrust": "Hip Thrust", "glute-bridge": "Glute Bridge", "cable-kickback": "Cable Glute Kickback", "hip-abduction": "Hip Abduction", "sumo-deadlift": "Sumo Deadlift", "trap-bar-deadlift": "Trap Bar Deadlift", "standing-calf-raise": "Standing Calf Raise", "seated-calf-raise": "Seated Calf Raise", "db-calf-raise": "Dumbbell Calf Raise", "plank": "Plank", "side-plank": "Side Plank", "crunch": "Crunch", "cable-crunch": "Cable Crunch", "hanging-leg-raise": "Hanging Leg Raise", "ab-wheel": "Ab Wheel Rollout", "russian-twist": "Russian Twist", "pallof-press": "Pallof Press", "kb-swing": "Kettlebell Swing", "kb-goblet-squat": "Kettlebell Goblet Squat", "turkish-get-up": "Turkish Get-up", "power-clean": "Power Clean", "thruster": "Thruster", "burpee": "Burpee", "band-pull-apart": "Band Pull-apart", "rowing-machine": "Rowing Machine", "treadmill": "Treadmill Run", "bike": "Stationary Bike", "jump-rope": "Jump Rope"};
let seed = 11; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
const R = (n, k = 2.5) => Math.round(n / k) * k;
const routines = [
  { id: "push", name: "Push", folder: "Push Pull Legs", exercises: [
    { ex: "bench-press", sets: 4, reps: 6, start: 72.5, step: .9, warm: true, rest: 150 },
    { ex: "overhead-press", sets: 3, reps: 8, start: 42.5, step: .45, rest: 120 },
    { ex: "incline-db-press", sets: 3, reps: 10, start: 24, step: .25, k: 2, rest: 90 },
    { ex: "lateral-raise", sets: 3, reps: 15, start: 9, step: .1, k: 1, rest: 60, superset: 1 },
    { ex: "rope-pushdown", sets: 3, reps: 12, start: 22.5, step: .2, rest: 60, superset: 1 },
  ] },
  { id: "pull", name: "Pull", folder: "Push Pull Legs", exercises: [
    { ex: "deadlift", sets: 3, reps: 5, start: 130, step: 1.6, warm: true, rest: 180 },
    { ex: "pull-up", sets: 4, reps: 8, start: 0, step: 0, rest: 120, bw: true },
    { ex: "barbell-row", sets: 3, reps: 8, start: 65, step: .6, rest: 120 },
    { ex: "face-pull", sets: 3, reps: 15, start: 20, step: .15, rest: 60, superset: 2 },
    { ex: "hammer-curl", sets: 3, reps: 12, start: 14, step: .12, k: 2, rest: 60, superset: 2 },
  ] },
  { id: "legs", name: "Legs", folder: "Push Pull Legs", exercises: [
    { ex: "back-squat", sets: 4, reps: 6, start: 95, step: 1.3, warm: true, rest: 180 },
    { ex: "romanian-deadlift", sets: 3, reps: 8, start: 80, step: .8, rest: 120 },
    { ex: "leg-press", sets: 3, reps: 12, start: 160, step: 2, k: 5, rest: 90 },
    { ex: "leg-curl", sets: 3, reps: 12, start: 40, step: .3, rest: 60 },
    { ex: "standing-calf-raise", sets: 4, reps: 12, start: 60, step: .4, rest: 60 },
  ] },
  { id: "full", name: "Full body, 40 minutes", folder: "Travel", exercises: [
    { ex: "goblet-squat", sets: 3, reps: 12, start: 24, step: 0, k: 2, rest: 60 },
    { ex: "push-up", sets: 3, reps: 15, start: 0, step: 0, rest: 60, bw: true },
    { ex: "db-row", sets: 3, reps: 10, start: 26, step: 0, k: 2, rest: 60 },
    { ex: "plank", sets: 3, reps: 45, start: 0, step: 0, rest: 45, bw: true },
  ] },
];
const days = []; // days back, ~3.5 a week, with a missed week in the middle
let back = 64, k = 0;
const order = ["push", "pull", "legs"];
while (back > 0) {
  if (!(back < 40 && back > 33)) days.push([back, order[k++ % 3]]);
  back -= [2, 2, 3][k % 3];
}
const workouts = [], log = [];
const done = {};
for (const [d, rid] of days) {
  const r = routines.find((x) => x.id === rid);
  const h = 6 + Math.floor(rnd() * 2), m = [5, 20, 35, 50][Math.floor(rnd() * 4)];
  const exs = [];
  let minutes = 0;
  for (const e of r.exercises) {
    const n = (done[e.ex] = (done[e.ex] || 0) + 1);
    const top = e.bw ? 0 : R(e.start + e.step * n * (n > 9 && n < 12 ? .9 : 1), e.k || 2.5);
    const sets = [];
    if (e.warm) { sets.push({ type: "warmup", kg: R(top * .5), reps: 8, done: true }); sets.push({ type: "warmup", kg: R(top * .75), reps: 4, done: true }); }
    for (let s = 0; s < e.sets; s++) {
      let reps = e.reps - (s === e.sets - 1 && rnd() < .35 ? 1 : 0) + (e.bw && rnd() < .3 ? 1 : 0);
      if (e.ex === "pull-up") reps = Math.min(12, 5 + Math.floor(n / 3) - (s > 1 ? 1 : 0));
      sets.push({ type: "normal", kg: top, reps, done: true, ...(s === e.sets - 1 && !e.bw && rnd() < .4 ? { rpe: 9 } : {}) });
    }
    if (e.ex === "rope-pushdown" && n % 3 === 0) sets.push({ type: "drop", kg: R(top * .7), reps: 10, done: true });
    exs.push({ ex: e.ex, sets, ...(e.superset ? { superset: e.superset } : {}), rest: e.rest });
    minutes += sets.length * 2.4;
  }
  const id = `w${String(64 - d).padStart(2, "0")}`;
  workouts.push({ id, routine: rid, name: r.name, start: `{{t-${d}@${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}}}`, minutes: Math.round(minutes + rnd() * 8), exercises: exs, created: `{{t-${d}@${String(h + 1).padStart(2, "0")}:00}}` });
  for (const e of exs) {
    const work = e.sets.filter((s) => s.type !== "warmup");
    const fmt = (s) => `${s.type === "warmup" ? "W " : s.type === "drop" ? "D " : ""}${s.kg ? `${String(s.kg).replace(".", ",")}×` : ""}${s.reps}${e.ex === "plank" ? "s" : ""}`;
    log.push(`| {{d-${d}}} | ${r.name} | ${NAMES[e.ex]} | ${e.sets.map(fmt).join(" · ")} |`);
  }
}


const bodyweight = [];
for (let d = 63; d >= 0; d -= 3 + Math.floor(rnd() * 3)) bodyweight.push({ id: `b${d}`, date: `{{d-${d}}}`, kg: Math.round((81.8 - (63 - d) * .028 + (rnd() - .5) * .8) * 10) / 10 });
const plan = routines.map((r) => ({ id: r.id, name: r.name, folder: r.folder, exercises: r.exercises.map((e) => ({ ex: e.ex, rest: e.rest, ...(e.superset ? { superset: e.superset } : {}), sets: [...(e.warm ? [{ type: "warmup", reps: 8 }, { type: "warmup", reps: 4 }] : []), ...Array.from({ length: e.sets }, () => ({ type: "normal", reps: e.reps }))] })) }));
const data = { values: { settings: { unit: "kg", rest: 120, restWarmup: 60, showRpe: true, bar: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25], notify: true, keepAwake: true }, routines: plan, folders: ["Push Pull Legs", "Travel"] }, collections: { workouts, bodyweight } };
fs.writeFileSync("data.json", JSON.stringify(data, null, 1));
fs.writeFileSync("note.md", `Lifting

Push, pull, legs since August. The app keeps the routines, the exercise library and the details of each set; every finished workout is also written into the log below.

## Log

| Date | Workout | Exercise | Sets |
| --- | --- | --- | --- |
${log.join("\n")}
`);
console.log(workouts.length, "workouts,", log.length, "log rows,", (JSON.stringify(data).length / 1024).toFixed(0), "KB data");
