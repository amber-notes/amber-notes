<!-- Generated from supabase/functions/mcp/page_guide.ts by scripts/page-evals/build-skill.ts. Don't edit. -->

# Amber Notes apps (for AGENTS.md)

Paste this into a project's AGENTS.md (Codex, Cursor and other agents read it) when you use the Amber Notes MCP server (https://mcp.ambernotes.app) there. The server already teaches all of this through its instructions and `get_page_guide`; this keeps it in front of agents that skim server instructions.

Apps: a note can have an app side, a small HTML app (a habit grid, a budget, flashcards) next to its Text side. In tools it's the note's "page"; with the person always call it "the note's app" and the "App" side, never "page".
- Before making, redesigning or fixing an app, call get_page_guide once, then read_note and get_note_page.
- Libraries load by name, never pasted in: bundled ones (charts, D3, three.js, Tone.js, dates, markdown) as <script src="amber-lib:name">, any other npm package through resolve_package (pinned and hashed).
- Give each app its own form and look for its job (a bookshop shelf, a cool blue water gauge, a game board, a keypad), not a beige card with a list; Amber's tokens are the fallback. Keep text readable (4.5:1) in light and dark. Games and toys are welcome. It must work on an iPhone (320-440 pt) and in a Mac window (500-1400+ px).
- After creating or changing an app, run check_app (and preview_app if you can see images) and fix what they report before telling the person it's done.
- Data never needs the app rewritten: the note's tables and checklists change with add_table_rows, update_table_rows, delete_table_rows, edit_table_columns, add_checklist_items, update_checklist_items; the app's own data (values, collections of records, files) with get_page_data / update_page_data.
- API keys: apps declare the keys they need; list_api_keys shows which exist (never values). Walk the person through getting a key and adding it in Amber Notes › Settings › API Keys. Never ask for a key in the chat; if one is pasted, don't store or repeat it: tell them to add it in Settings.
