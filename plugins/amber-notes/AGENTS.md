<!-- Generated from supabase/functions/mcp/page_guide.ts by scripts/page-evals/build-skill.ts. Don't edit. -->

# Amber Notes apps (for AGENTS.md)

Paste this into a project's AGENTS.md (Codex, Cursor and other agents read it) when you use the Amber Notes MCP server (https://mcp.ambernotes.app) there. The server already teaches all of this through its instructions and `get_page_guide`; this keeps it in front of agents that skim server instructions.

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

The default look every app starts with, amber-base.css (the real file; override any rule, or opt out with `<meta name="amber-base" content="none">`):

```css
/* amber-base.css, version 1 (Amber Notes). The default stylesheet every note's app gets.
   It is loaded before the app's own styles, inside the cascade layer "amber-base", so any style the
   app writes wins over it, whatever its specificity. There is nothing else: no other styles are
   added to an app, and no rule here is marked important.
   The colours and sizes are variables from amber-tokens.css (loaded first, layer "amber-tokens"),
   already switched for light and dark. To style everything yourself:
     <meta name="amber-base" content="none">   keeps amber-tokens.css, drops this file. */

@layer amber-tokens, amber-base;

@layer amber-base {
  /* Page: the note's background, the system font at the reader's text size (iPhone: Dynamic Type,
     so rem follows it; Mac: 14px). */
  html { font: var(--amber-root-font); -webkit-text-size-adjust: 100%; color-scheme: light dark; }
  body { margin: 0; font-size: 1rem; line-height: 1.35; background: var(--amber-bg); color: var(--amber-text); font-family: var(--amber-font); }

  /* Never wider than the note: something too wide is clipped, not panned to. */
  html, body { overflow-x: clip; }
  :where(img, video, canvas, svg, iframe, pre) { max-width: 100%; }

  /* Fields: every input visible as a field, in both themes. */
  :where(input:not([type=checkbox], [type=radio], [type=range], [type=color], [type=file], [type=hidden]), select, textarea) {
    background: var(--amber-field); color: var(--amber-text); border: 1px solid var(--amber-field-border);
    border-radius: var(--amber-radius-small); font: inherit; padding: 6px 10px;
  }
  :where(input, select, textarea, button, a):focus-visible { outline: 2px solid var(--amber-accent); outline-offset: 1px; }
  :where(input[type=checkbox], input[type=radio], input[type=range], progress) { accent-color: var(--amber-accent); }

  /* Buttons: the app's font; the rest is up to the app. */
  :where(button) { font: inherit; color: inherit; }

  /* Links and lines. */
  :where(a) { color: var(--amber-accent-text); }
  :where(hr) { border: 0; border-top: 1px solid var(--amber-separator); margin: 16px 0; }
}
```
