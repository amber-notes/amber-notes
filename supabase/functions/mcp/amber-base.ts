// Generated from Pane/Resources/AppLibraries/amber-base.css (the file the app ships); the tests in
// page.test.ts and NotePageTests keep them the same. Shown to the AI as the real stylesheet.
export const AMBER_BASE_CSS = `/* amber-base.css, version 1 (Amber Notes). The default stylesheet every note's app gets.
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
`;

/** The variables in amber-tokens.css (values differ per device and switch with dark mode). */
export const AMBER_TOKENS = [
  "--amber-bg", "--amber-surface", "--amber-fill", "--amber-text", "--amber-text-secondary", "--amber-separator",
  "--amber-field", "--amber-field-border", "--amber-accent", "--amber-accent-text", "--amber-accent-soft", "--amber-on-accent",
  "--amber-danger", "--amber-radius", "--amber-radius-small", "--amber-content-max", "--amber-gutter", "--amber-root-font",
  "--amber-font", "--amber-font-rounded", "--amber-font-mono", "--amber-safe-top", "--amber-safe-right", "--amber-safe-bottom", "--amber-safe-left", "--amber-inset-bottom", "--amber-keyboard",
];
