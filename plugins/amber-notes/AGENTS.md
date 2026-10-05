<!-- Generated from supabase/functions/mcp/page_guide.ts by scripts/page-evals/build-skill.ts. Don't edit. -->

# Amber Notes apps (for AGENTS.md)

Paste this into a project's AGENTS.md (Codex, Cursor and other agents read it) when you use the Amber Notes MCP server (https://mcp.ambernotes.app) there. The server already teaches all of this through its instructions and `get_page_guide`; this keeps it in front of agents that skim server instructions.

Apps: a note in Amber Notes can be an app. Call it "the note's app" with the person, never "page" (some tools still say page).
- Before making or changing an app, call get_page_guide once. It says where an app lives; how it looks and works is up to you.
- An app is a normal Vite + React + TypeScript + Tailwind + shadcn/ui project. create_app starts one; list_app_files, read_app_file, write_app_file and edit_app_file work on it like any codebase. Every save compiles it and tells you what broke.
- Its data is JSON the app keeps (useStore, useCollection, useSettings from "@/lib/amber", or localStorage: all synced and encrypted). You read and change it with get_page_data, query_app_data and update_page_data.
- It runs inside a note on iPhone and Mac, light and dark, with no network except hosts the person allows.
- See your work with preview_app and check_app before you say it's done.

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
