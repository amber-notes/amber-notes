# Training

Strength training over the note's Plan and Log tables.

- `src/App.jsx`: the screens (Today, Plan, Progress) in an amber-ui Shell, plus Settings.
- `src/data.js`: small helpers. The note's tables come from `useTable("Plan")` and `useTable("Log")` (from "amber"); logging a set is `log.add({...})`.
- `src/screens/`: one file per screen. `src/components/`: pieces used by several screens.
- Settings (units, weekly goal) are kept with useSettings, in the app's own data, not the note.
