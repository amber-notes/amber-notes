// Sends every lifecycle email to a few test inboxes, so they can be checked in real Gmail, Apple Mail
// and Outlook before the emails go live. Reads no database and sends to nobody but the addresses
// given. Without --send it only prints what it would send.
//
//   RESEND_LIFECYCLE_KEY=re_... deno run -A scripts/lifecycle-test-send.ts --to me@gmail.com,me@icloud.com,me@outlook.com
//   ... --send                 actually send (otherwise a dry run)
//   ... --only connect,try     some emails only
//   ... --assets <url>         where the pictures are (default https://pintonotes.com/email; the site
//                              deploy that adds them must be live, or the pictures are broken)
//
// Each email's subject starts with "[Test n/N]" and its unsubscribe link goes to a test address that
// does nothing. Needs the ambernotes.app domain verified in the Resend account the key belongs to.
import { KINDS, render } from "../supabase/functions/lifecycle/emails.ts";
import type { Kind } from "../supabase/functions/lifecycle/logic.ts";
import { APP_LINKS, FROM, REPLY_TO, SITE } from "../supabase/functions/lifecycle/logic.ts";
import { resend } from "../supabase/functions/lifecycle/run.ts";

const arg = (name: string) => { const i = Deno.args.indexOf(name); return i >= 0 ? Deno.args[i + 1] : undefined; };
const to = (arg("--to") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const only = arg("--only")?.split(",").map((s) => s.trim()) as Kind[] | undefined;
const assets = arg("--assets") ?? `${SITE}/email`;
const send = Deno.args.includes("--send");

if (to.length === 0 || to.length > 10 || to.some((a) => !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(a))) {
  console.error("Give 1 to 10 test addresses with --to a@x.com,b@y.com");
  Deno.exit(1);
}
const key = Deno.env.get("RESEND_LIFECYCLE_KEY") ?? "";
if (send && !key) { console.error("Set RESEND_LIFECYCLE_KEY."); Deno.exit(1); }

const base = { site: SITE, open: APP_LINKS, assets, unsubscribe: `${SITE}/unsubscribe?u=test&t=test`, sortable: false, connectTried: false };
const variants = [
  ...KINDS.map((kind) => ({ kind, label: kind, ctx: base })),
  { kind: "connect" as Kind, label: "connect, sorting into folders", ctx: { ...base, sortable: true } },
  { kind: "connect" as Kind, label: "connect, connection waiting", ctx: { ...base, connectTried: true } },
].filter((v) => !only || only.includes(v.kind));

const run = crypto.randomUUID().slice(0, 8);
const out = resend(key);
let n = 0;
for (const v of variants) {
  n++;
  const e = render(v.kind, v.ctx);
  const subject = `[Test ${n}/${variants.length}] ${e.subject}`;
  for (const address of to) {
    if (!send) { console.log(`would send to ${address}: ${subject}  (${v.label})`); continue; }
    const r = await out({ from: FROM, to: address, reply_to: REPLY_TO, subject, html: e.html, text: e.text,
      headers: { "List-Unsubscribe": `<${SITE}/unsubscribe/confirm?u=test&t=test>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      idempotencyKey: `lifecycle-test-${run}-${n}-${address}` });
    console.log(`${r.ok ? "sent" : `failed (${r.status})`} to ${address}: ${subject}`);
    await new Promise((r) => setTimeout(r, 600));
  }
}
if (!send) console.log(`\nDry run. Add --send to send ${variants.length * to.length} emails.`);
