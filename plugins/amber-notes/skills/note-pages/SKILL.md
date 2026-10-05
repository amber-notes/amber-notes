---
name: note-pages
description: Build, change, check and fill the apps in Amber Notes notes (a note's App side: habit trackers, budgets, reading or workout logs, CRMs, trip plans, flashcards, dashboards) through the amber-notes MCP server, and put data into them: rows, records, settings, files. Use when the person asks to make a note an app, change or fix a note's app, add or import data to it, or set up an API key for one.
---
<!-- Generated from supabase/functions/mcp/page_guide.ts by scripts/page-evals/build-skill.ts. Don't edit. -->

# Apps in Amber Notes notes

Apps: a note can have an app side, a small app (a habit tracker, a budget, a training log) next to its Text side. With the person always call it "the note's app" and the "App" side, never "page" (some tools still say page).
- Before making, redesigning or fixing an app, call get_page_guide once, then read_note; for an existing app, list_app_files and its README.md.
- An app is a normal small Preact project: create_app makes it (index.html, src/main.jsx, src/App.jsx with a tab bar on iPhone and a sidebar from 900 px, src/screens/, src/components/, src/styles.css, README.md); read_app_file, write_app_file and edit_app_file change it like any codebase. Every write compiles JSX and answers with what to fix.
- Use the hooks: import { useNote, useTable, useChecklist, useAppData, useSettings, batch } from "amber"; tables and checklists by the heading above them (useTable("Log")), never by position, never window.amber. Components from "amber-ui" (Shell, List, ListRow, Sheet, Input, Button, Stat, Icon…), screens with "amber-router", libraries by npm name (import Chart from "chart.js").
- Every app starts with amber-base.css, the default look (get_page_guide shows the real file): it sits in a cascade layer, so any style you write wins over it without !important. Keep every input visible as a field in both themes.
- Design around the person's job with one focus per screen; other screens, pushed screens and sheets for the rest (a training app opens on today's workout; plan and progress are other screens). Settings live inside the app (useSettings, a Settings screen).
- Give each app its own look for its job, not a beige card with a list; keep text readable (4.5:1) in light and dark. Games and toys are welcome. It must work on an iPhone (320-440 pt) and in a Mac window (500-1400+ px), using the room when it's wide.
- When it's done, run check_app (and preview_app if you can see images) and fix what they report before telling the person.
- Data never needs the app rewritten: the note's tables and checklists change with add_table_rows, update_table_rows, delete_table_rows, edit_table_columns, add_checklist_items, update_checklist_items; the app's own data with get_page_data / update_page_data.
- API keys: apps declare the keys they need; list_api_keys shows which exist (never values). Walk the person through getting a key and adding it in Amber Notes › Settings › API Keys. Never ask for a key in the chat; if one is pasted, don't store or repeat it: tell them to add it in Settings.

Read `references/guide.md` before building or changing an app: the project and its hooks, where data lives, design and accessibility, API keys and the check-before-done loop. `references/amber-base.css` is the default stylesheet every app starts with, the real file: override any rule (it sits in a cascade layer, so no !important) or opt out with `<meta name="amber-base" content="none">`. `examples/training/` is a complete app project to learn from; the server serves the same guide and example through `get_page_guide`, so nothing here is needed for the tools to work.
