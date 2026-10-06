// Renders every lifecycle email to a folder, as HTML (as sent, always light, and always dark as
// Apple Mail shows it) and plain text, with the pictures next to them, so they can be opened in a browser or screenshotted.
// Sends nothing and reads no database.
//   deno run -A scripts/lifecycle-preview.ts <folder> [<folder of unreleased art>]
// The apps and share emails show features that haven't shipped; their captures stay out of this
// public repository until then (see docs/Technical/lifecycle-emails.md) and come from the second folder.
import { KINDS, render } from "../supabase/functions/lifecycle/emails.ts";

const out = Deno.args[0];
if (!out) throw new Error("Usage: deno run -A scripts/lifecycle-preview.ts <folder>");
await Deno.mkdir(`${out}/email`, { recursive: true });
const art = new URL("../web/public/email/", import.meta.url);
for (const f of Deno.readDirSync(art)) await Deno.copyFile(new URL(f.name, art), `${out}/email/${f.name}`);
if (Deno.args[1]) for (const f of Deno.readDirSync(Deno.args[1])) await Deno.copyFile(`${Deno.args[1]}/${f.name}`, `${out}/email/${f.name}`);

const base = { site: "https://ambernotes.app", assets: "email", unsubscribe: "https://ambernotes.app/unsubscribe?u=preview&t=preview", sortable: false, connectTried: false };
const variants = [
  ...KINDS.map((kind) => ({ kind, name: kind, ctx: base })),
  // A big library mostly in one folder: the connect email shows sorting instead.
  { kind: "connect" as const, name: "connect-sorting", ctx: { ...base, sortable: true } },
  // The welcome's other steps (signed up through ChatGPT or Claude: get the app; app and AI: try an
  // ask), and the welcome without its picture, to compare.
  { kind: "welcome" as const, name: "welcome-app", ctx: { ...base, step: "app" as const } },
  { kind: "welcome" as const, name: "welcome-try", ctx: { ...base, step: "try" as const } },
  { kind: "welcome" as const, name: "welcome-plain", ctx: { ...base, plain: true } },
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
  // Pictures blocked, as Outlook shows mail by default: no src, so only the alt text and the cells'
  // own colours remain.
  if (v.name === "stuck" || v.name === "connect" || v.name === "welcome") {
    const blocked = (html: string) => html.replace(/ src="[^"]*"/g, "");
    await Deno.writeTextFile(`${out}/${v.name}-blocked-light.html`, blocked(light));
    await Deno.writeTextFile(`${out}/${v.name}-blocked-dark.html`, blocked(dark));
  }
  await Deno.writeTextFile(`${out}/${v.name}.txt`, `Subject: ${e.subject}\nPreview: ${e.preview}\n\n${e.text}`);
  index.push({ name: v.name, kind: v.kind, subjectB: render(v.kind, { ...v.ctx, variant: 1 }).subject, previewB: render(v.kind, { ...v.ctx, variant: 1 }).preview, subject: e.subject, preview: e.preview, bytes: new TextEncoder().encode(e.html).length });
}
await Deno.writeTextFile(`${out}/emails.json`, JSON.stringify(index, null, 2));
console.log(`${variants.length} emails in ${out}`);
