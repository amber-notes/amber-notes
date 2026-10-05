// Renders every lifecycle email to a folder, as HTML (as sent, always light, and always dark as
// Apple Mail shows it) and plain text, with the pictures next to them, so they can be opened in a browser or screenshotted.
// Sends nothing and reads no database.
//   deno run -A scripts/lifecycle-preview.ts <folder>
import { KINDS, render } from "../supabase/functions/lifecycle/emails.ts";

const out = Deno.args[0];
if (!out) throw new Error("Usage: deno run -A scripts/lifecycle-preview.ts <folder>");
await Deno.mkdir(`${out}/email`, { recursive: true });
const art = new URL("../web/public/email/", import.meta.url);
for (const f of Deno.readDirSync(art)) await Deno.copyFile(new URL(f.name, art), `${out}/email/${f.name}`);

const base = { site: "https://ambernotes.app", assets: "email", unsubscribe: "https://ambernotes.app/unsubscribe?u=preview&t=preview", noteCount: 3, imported: false, connectTried: false };
const variants = [
  ...KINDS.map((kind) => ({ kind, name: kind, ctx: base })),
  // An imported library of 179 notes: the connect email shows sorting, with the number.
  { kind: "connect" as const, name: "connect-imported", ctx: { ...base, noteCount: 179, imported: true } },
  // A connection started and waiting: the last line says how to finish.
  { kind: "connect" as const, name: "connect-tried", ctx: { ...base, connectTried: true } },
  // The template cards' second option, for comparison.
  { kind: "templates" as const, name: "templates-amber", ctx: { ...base, cards: "amber" as const } },
];
const index: unknown[] = [];
for (const v of variants) {
  const e = render(v.kind, v.ctx);
  // Dark: the dark-mode rules applied unconditionally, which is what Apple Mail does in Dark Mode.
  const dark = e.html.replace("@media (prefers-color-scheme: dark) {", "@media all {").replace('<meta name="color-scheme" content="light dark">', '<meta name="color-scheme" content="dark">');
  // Light: the dark-mode rules switched off, for a screenshot on a Mac that is in Dark Mode.
  const light = e.html.replace("@media (prefers-color-scheme: dark) {", "@media not all {");
  await Deno.writeTextFile(`${out}/${v.name}.html`, e.html);
  await Deno.writeTextFile(`${out}/${v.name}-light.html`, light);
  await Deno.writeTextFile(`${out}/${v.name}-dark.html`, dark);
  await Deno.writeTextFile(`${out}/${v.name}.txt`, `Subject: ${e.subject}\nPreview: ${e.preview}\n\n${e.text}`);
  index.push({ name: v.name, kind: v.kind, noteCount: v.ctx.noteCount, imported: v.ctx.imported, connectTried: v.ctx.connectTried, subject: e.subject, preview: e.preview, bytes: new TextEncoder().encode(e.html).length });
}
await Deno.writeTextFile(`${out}/emails.json`, JSON.stringify(index, null, 2));
console.log(`${variants.length} emails in ${out}`);
