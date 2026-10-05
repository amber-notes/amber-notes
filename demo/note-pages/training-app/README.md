# Training

A strength-training app. Its data is JSON in the app's own store (see `src/data.js`):
`plan` (the days and their exercises) and the `log` collection (every set). The first time it
opens, it starts from the tables the note held before it became an app.

- `src/App.jsx`: the screens (Today, Plan, Progress) in an amber-ui Shell, plus Settings.
- `src/screens/`: one file per screen. `src/components/`: pieces used by several screens.
- Settings (units, weekly goal) are kept with useSettings. The note-list line comes from setSummary.
