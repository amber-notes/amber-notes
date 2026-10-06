// Demo data for Evening: six weeks of made-up evenings ending last night, tonight not logged yet.
// Real dates, so run it again on the day of a recording (the weekday decides which habits are due).
//   node gen.mjs  ->  data.json
import fs from "node:fs";
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const clamp = (v) => Math.max(1, Math.min(10, Math.round(v)));
const now = new Date(Date.now() - 4 * 3600e3); const back = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return d; };
const dow = (n) => back(n).getDay(), iso = (n) => back(n).toLocaleDateString("sv-SE");
const HABITS = { exercise: [1,3,5], walk: [0,1,2,3,4,5,6], reading: [0,1,2,3,4,5,6], plan: [0,1,2,3,4] };
const HELPED = ["Early gym", "Phone in the other room", "Deep work block before lunch", "Walk after lunch", "Clear win condition", "Cooked dinner", "Early gym, deep work block before lunch", "Slept 8 hours", "Clear win condition and first task ready"];
const HURT = ["Late meeting ran over", "Slack all afternoon", "Slept badly", "Too many small tasks", "Skipped lunch", "Late meeting ran over, skipped lunch", "Context switching", "Slack all afternoon"];
const WINS = [["Ship the onboarding fix to prerelease", ["Fix merged and tested", "Two investor replies sent", "Gym before work"], "Reproduce the sign-in bug"],
  ["Pricing page live", ["Copy final", "Stripe test passes"], "Write the plan-card copy"],
  ["Demo ready for Thursday", ["Script done", "Recording clean", "Slides in order"], "Outline the demo in ten bullets"],
  ["Hire decision made", ["Two references called", "Offer drafted"], "Call the first reference"]];
const days = [];
for (let n = 42; n >= 1; n--) {
  const wd = dow(n), skip = rnd() < 0.1 && n > 2;
  if (skip) continue;
  const base = 6 + Math.sin(n / 5) * 1.2, work = wd === 0 || wd === 6 ? pick([0, 0, 1, 2]) : pick([6.5, 7, 7.5, 8, 8, 8.5, 9]);
  const goodRatio = 0.45 + rnd() * 0.3 + (n < 14 ? 0.08 : 0);
  const habits = {};
  for (const [id, ds] of Object.entries(HABITS)) habits[id] = ds.includes(wd) ? (rnd() < (id === "plan" ? 0.62 : id === "reading" ? 0.7 : 0.82) ? "Yes" : "No") : "N/A";
  const w = pick(WINS), sleep = clamp(base + (rnd() - 0.5) * 3);
  days.push({ date: iso(n), workHours: work, goodWorkHours: Math.round(work * goodRatio * 2) / 2, energy: clamp(base + (sleep - 6) * 0.5 + (rnd() - 0.5) * 2), mood: clamp(base + 0.8 + (rnd() - 0.5) * 2.4),
    focus: clamp(base + goodRatio * 3 - 1.2 + (rnd() - 0.5) * 2), sleep, habits, helped: rnd() < 0.85 ? pick(HELPED) : "", hurt: rnd() < 0.75 ? pick(HURT) : "", notes: rnd() < 0.2 ? pick(["Good call with the design partner.", "Felt flat in the afternoon.", "Two hours lost to a broken build."]) : "",
    tomorrow: { win: w[0], outcomes: w[1], firstTask: w[2], alarmsSet: rnd() < 0.8 }, loggedAt: `${iso(n)}T21:${String(20 + Math.floor(rnd() * 30)).padStart(2, "0")}:00` });
}
// Last night: a clear plan for today.
const last = days.find((d) => d.date === iso(1)); if (last) last.tomorrow = { win: "Ship the onboarding fix to prerelease", outcomes: ["Fix merged and tested", "Two investor replies sent", "Gym before work"], firstTask: "Reproduce the sign-in bug, 8:30", alarmsSet: true };
const notes = ["Too many meetings on Tuesday. Protect mornings.", "Good week. Keep the early gym.", "Sleep slipped on Thursday: lights out by 23:00.", "Replies keep sliding: do them before leaving, not after.", "Steady. Same budget."];
const weeks = [5, 4, 3, 2, 1].map((k, i) => ({ id: "w" + k, start: iso((now.getDay() + 6) % 7 + 7 * k), target: 71, note: notes[i] }));
fs.writeFileSync(new URL("./data.json", import.meta.url), JSON.stringify({ values: {}, collections: { days: days.map((d, i) => ({ id: "d" + i, ...d })), weeks } }, null, 1));
console.log(days.length, "days");
