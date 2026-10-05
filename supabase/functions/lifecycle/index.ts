// The onboarding emails (docs/Technical/lifecycle-emails.md).
//
//   POST /functions/v1/lifecycle               one round. pg_cron calls it daily (lifecycle_tick in
//        x-lifecycle-secret: <LIFECYCLE_CRON_SECRET>   20261006090000_lifecycle_emails.sql).
//        → 200 { enabled, accounts, due, sent, failed, deferred }   (counts only, never who)
//   POST /functions/v1/lifecycle/unsubscribe?u=<account id>&t=<token>
//        → 200 { ok: true } · 400 a link that isn't one. Called by ambernotes.app/unsubscribe/confirm,
//        which is where the email's link and its List-Unsubscribe header point.
//
// Sends nothing unless LIFECYCLE_ENABLED is "true", LIFECYCLE_SINCE is set, and RESEND_LIFECYCLE_KEY,
// LIFECYCLE_UNSUBSCRIBE_SECRET and LIFECYCLE_CRON_SECRET are present. verify_jwt is off for this
// function: the round checks its own secret, and an unsubscribe link carries its own HMAC.
import { connect, readiness } from "../_shared/db.ts";
import { atHome } from "../_shared/region.ts";
import { errorKind, log } from "../_shared/log.ts";
import { config, sameSecret, validUnsubscribe } from "./logic.ts";
import { resend, run } from "./run.ts";

const sql = connect(Deno.env, 2);
const ready = readiness(sql);

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

Deno.serve(atHome("lifecycle", async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*?\/lifecycle/, "") || "/";
  if (req.method !== "POST") return reply({ error: "method not allowed" }, 405);

  if (path === "/unsubscribe") {
    const secret = (Deno.env.get("LIFECYCLE_UNSUBSCRIBE_SECRET") ?? "").trim();
    const userId = url.searchParams.get("u")?.toLowerCase();
    if (!secret || !(await validUnsubscribe(secret, userId, url.searchParams.get("t")))) return reply({ error: "bad link" }, 400);
    const source = url.searchParams.get("via") === "header" ? "header" : "link";
    await ready();
    try {
      // An account deleted since has no row to point at; that's a stop too.
      await sql`insert into public.email_unsubscribes (user_id, source)
        select ${userId!}::uuid, ${source} where exists (select 1 from auth.users where id = ${userId!}::uuid)
        on conflict (user_id) do nothing`;
      log("lifecycle_unsubscribe", { kind: source });
      return reply({ ok: true });
    } catch (e) {
      log("lifecycle_unsubscribe", { status: "failed", ...errorKind(e) });
      return reply({ error: "unavailable" }, 500);
    }
  }

  if (path === "/" || path === "/run") {
    const settings = config(Deno.env);
    if (!settings.ok) {
      log("lifecycle_round", { status: "off", kind: settings.reason });
      return reply({ enabled: false, reason: settings.reason });
    }
    if (!sameSecret(req.headers.get("x-lifecycle-secret") ?? "", settings.config.cronSecret)) return reply({ error: "not allowed" }, 401);
    await ready();
    try {
      const report = await run({ sql, send: resend(settings.config.resendKey), cfg: settings.config });
      log("lifecycle_round", { status: report.enabled ? "on" : "off", count: report.sent, attempts: report.failed });
      return reply(report);
    } catch (e) {
      log("lifecycle_round", { status: "failed", ...errorKind(e) });
      return reply({ error: "unavailable" }, 500);
    }
  }

  return reply({ error: "not found" }, 404);
}));
