---
name: note-pages
description: Build, change, check and fill the apps in Amber Notes notes (a note's App side: habit trackers, budgets, reading or workout logs, CRMs, trip plans, flashcards, dashboards) through the amber-notes MCP server, and put data into them: rows, records, settings, files. Use when the person asks to make a note an app, change or fix a note's app, add or import data to it, or set up an API key for one.
---
<!-- Generated from supabase/functions/mcp/page_guide.ts by scripts/page-evals/build-skill.ts. Don't edit. -->

# Apps in Amber Notes notes

Apps: a note in Amber Notes can be an app. Call it "the note's app" with the person, never "page" (some tools still say page).
- Before making or changing an app, call get_page_guide once. It says where an app lives; how it looks and works is up to you.
- An app is a normal Vite + React + TypeScript + Tailwind + shadcn/ui project. create_app starts one; list_app_files, read_app_file, write_app_file and edit_app_file work on it like any codebase. Every save compiles it and tells you what broke.
- Its data is JSON the app keeps (useStore, useCollection, useSettings from "@/lib/amber", or localStorage: all synced and encrypted). You read and change it with get_page_data, query_app_data and update_page_data.
- It runs inside a note on iPhone and Mac, light and dark, with no network except hosts the person allows.
- See your work with preview_app and check_app before you say it's done.

Read `references/guide.md` before building or changing an app: the project and its hooks, where data lives, design and accessibility, API keys and the check-before-done loop. `references/amber-base.css` is the default stylesheet every app starts with, the real file: override any rule (it sits in a cascade layer, so no !important) or opt out with `<meta name="amber-base" content="none">`. `examples/training/` is a complete app project to learn from; the server serves the same guide and example through `get_page_guide`, so nothing here is needed for the tools to work.
