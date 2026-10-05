// Note page widgets (prototype): set_note_widget, the tool an AI uses to give a note's app a
// home-screen widget. What a widget may hold, and its check, are in widget_spec.ts (pure, tested).

import { findNote, ToolError, type Call, type Tx } from "./tools.ts";
import { WIDGET_CONTRACT, widgetProblems } from "./widget_spec.ts";

type Args = Record<string, unknown>;
const str = (d: string) => ({ type: "string", description: d });
const noteRef = { id: str("Note id (preferred)."), title: str("Note title, if you don't have the id. Must match one note.") };
const change = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

export const widgetTools = [
  {
    name: "set_note_widget", title: "Make a widget for a note",
    description: "Gives a note a home-screen widget (iPhone home and Lock Screen, Mac desktop): the widget for the note's app, made of a few native blocks whose values bind to the note's tables and checklists, " +
      "such as a habit streak with a ring and a Done button, or this month's total. Widgets can't run HTML, so this is a separate small spec, usually made alongside the note's app (set_note_page). " +
      "Replaces the note's widget; null or an empty object removes it. The person adds it from the home screen's widget gallery (Amber Notes, Note). When talking to the person, call it the widget for the note's app, never a page.\n" + WIDGET_CONTRACT,
    inputSchema: { type: "object", properties: { ...noteRef, widget: { type: ["object", "null"], description: "The widget spec, or null to remove it." } }, required: ["widget"] },
    annotations: { ...change, idempotentHint: true },
  },
];

export const widgetHandlers: Record<string, (tx: Tx, a: Args, c: Call) => Promise<unknown>> = {
  async set_note_widget(tx, a, c) {
    const n = await findNote(tx, c, a);
    const w = a.widget;
    if (w === null || w === undefined || (typeof w === "object" && !Array.isArray(w) && !Object.keys(w).length)) {
      const gone = await tx`update public.note_pages set widget_ct = null where note_id = ${n.id} and widget_ct is not null returning note_id`;
      return { id: n.id, title: n.title, widget: gone.length ? "removed" : "none" };
    }
    const problems = widgetProblems(w);
    if (problems.length) throw new ToolError(`The widget wasn't saved:\n- ${problems.join("\n- ")}`);
    const json = typeof w === "string" ? w : JSON.stringify(w);
    const sealed = await c.v.sealWidget(n.id, json);
    const [{ created }] = await tx<{ created: boolean }[]>`
      insert into public.note_pages (note_id, widget_ct) values (${n.id}, ${sealed})
      on conflict (note_id) do update set widget_ct = excluded.widget_ct
      returning (xmax = 0) as created`;
    return { id: n.id, title: n.title, widget: created ? "created" : "replaced",
      note: "The person adds it from the home screen's widget gallery (Amber Notes, Note). It updates as the note changes." };
  },
};
