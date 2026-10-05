# Training

Strength training over the note's Plan and Log tables.

- `src/App.jsx`: the screens (Today, Plan, Progress) in an amber-ui Shell, plus Settings.
- `src/data.js`: reads the note's tables; logging a set appends a row to Log.
- `src/screens/`: one file per screen. `src/components/`: pieces used by several screens.
- Settings (units, weekly goal) are kept in the app's own data, not the note.
