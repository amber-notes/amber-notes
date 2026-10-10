# Evening

A two-minute evening check-in, made from an evening tracker spreadsheet. It opens on the Overview:
tonight (logged or not), today's win condition, the week's hours against its budget, how the days
felt, and habits done of scheduled. "Log today" walks through five steps: work hours, four ratings,
today's habits (only the ones planned for today), what helped or hurt, and tomorrow's win. Finish
lands back on the Overview.

- A React + TypeScript + Tailwind + shadcn/ui + lucide + recharts project; the Calm look's colours are in
  `src/index.css`, its pieces (steppers, the 1-10 scale, Yes/No) in `src/components/calm.tsx`.
- Data (`src/lib/evening.ts`): JSON in the app's store. `days` holds one record per evening with the
  spreadsheet's columns plus `tomorrow`; `weeks` holds each week's budget and note; the plan is in
  settings. Plan has the import (paste rows from the sheet or a CSV) and CSV/JSON export.
- Screens (`src/screens/`): overview, check-in (/log/:date, any day), week (the Sunday review), trends, plan.
