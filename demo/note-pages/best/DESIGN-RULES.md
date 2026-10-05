# Design rules for note apps

What the best-apps set follows, after Emil's review. Written for the AI guide (page_guide.ts).

## One focus per screen

1. Name the app's job in one sentence before designing ("start today's workout and log it set by set"). The first screen does that job and nothing else competes with it.
2. One primary action per screen, big and obvious (Start, Add, Study now). Everything else is quieter.
3. A screen that tries to show today, history, settings and editing at once is several screens. Split it.
4. Use app structure when there's more than one job:
   - Tabs: 2 to 4 sections named by what the person does or looks at (Today, Plan, Progress). A bottom tab bar on the phone, a sidebar from 900 px.
   - Push a screen for a single thing (one workout, one person, one plan) with a back button that names where it goes.
   - A doing-mode screen (a workout, a review, cooking) hides the tabs and shows one step at a time.
   - Sheets for short tasks that come back to where you were (add, edit, pick). Not for whole sections.
5. Summary before detail: the number that matters at the top, the list after, the history on its own tab.

## Sheets and popups

6. One sheet at a time. A fixed header (title, close) and a body that scrolls on its own; the page behind doesn't scroll.
7. The sheet's main action is pinned to its bottom and never scrolls away.
8. On the phone a sheet rises from the bottom and sits above the keyboard (use visualViewport); a focused field scrolls into view. From 700 px it's a centred panel no taller than the window.
9. Escape and the scrim close it; focus goes in, and comes back to what opened it.
10. Nothing floats over content the person is working on: toasts and timers sit in their own space, not over a field or the last row.

## Fit

11. Nothing is ever wider than the window. Check 320, 390 and 1440 px. Flex and grid children that hold text get min-width: 0; long words wrap.
12. Rows with several controls wrap onto a second line on the phone instead of shrinking or clipping. Prefer stepper values with their unit ("5 reps") over separate labels.
13. Decorations stay inside their box. Clipping with overflow: hidden is only for things meant to be cut (images, ellipsis text).
14. A wide window gets a real wide layout (a sidebar, two columns, a bigger board), never a phone column floating in the middle.
15. Fixed bars respect the safe area and the app's own bottom chrome (env(safe-area-inset-bottom) plus the host's inset).

## Look and data

16. Only the --amber-* variables for colour, plus a small palette of your own with dark variants. Both themes designed, not inverted.
17. Settings live in amber-settings (shown natively under App Settings). No in-app gear.
18. The note keeps what a person or AI should read (tables, checklists); the app's own data keeps state (a workout in progress, scores, schedules). App-data writes are quiet; note edits get a receipt with Undo, batched so one action is one Undo.
19. Motion explains a change (a pushed screen slides, a sheet rises, a tick pops) and respects reduced motion.
20. Check every screen and every sheet in light and dark at 320, 390 and 1440 px before calling it done.
