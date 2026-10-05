---
name: note-pages
description: Build, change, check and fill the apps in Amber Notes notes (a note's App side: habit trackers, budgets, reading or workout logs, CRMs, trip plans, flashcards, dashboards) through the amber-notes MCP server, and put data into them: rows, records, settings, files. Use when the person asks to make a note an app, change or fix a note's app, add or import data to it, or set up an API key for one.
---
<!-- Generated from supabase/functions/mcp/page_guide.ts by scripts/page-evals/build-skill.ts. Don't edit. -->

# Apps in Amber Notes notes

Apps: a note can have an app side, a small HTML app (a habit grid, a budget, flashcards) next to its Text side. In tools it's the note's "page"; with the person always call it "the note's app" and the "App" side, never "page".
- Before making, redesigning or fixing an app, call get_page_guide once, then read_note and get_note_page.
- Make each app fit its job (a game, a dial, a calendar wall, a keypad), not always a card with a list; Amber's colors and dark mode are the base. Games and toys are welcome. It must work on an iPhone (320-440 pt) and in a Mac window (500-1400+ px).
- After creating or changing an app, run check_app (and preview_app if you can see images) and fix what they report before telling the person it's done.
- Data never needs the app rewritten: the note's tables and checklists change with add_table_rows, update_table_rows, delete_table_rows, edit_table_columns, add_checklist_items, update_checklist_items; the app's own data (values, collections of records, files) with get_page_data / update_page_data.
- API keys: apps declare the keys they need; list_api_keys shows which exist (never values). Walk the person through getting a key and adding it in Amber Notes › Settings › API Keys. Never ask for a key in the chat; if one is pasted, don't store or repeat it: tell them to add it in Settings.

Read `references/guide.md` before building or changing an app: the window.amber contract, where data lives, design and accessibility, API keys, the check-before-done loop and a starter. `templates/` holds tested apps to start from; the server serves the same guide and templates through `get_page_guide`, so nothing here is needed for the tools to work.
