// Tip events (20260929230000_tip_events.sql): the apps count "tip shown" and "used after the
// tip" per account and day, only for known tips, and only the service role reads the report.
// Runs against the LOCAL stack inside a transaction that is always rolled back:
//   scripts/mcp-e2e.sh tips.e2e.test.ts
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import postgres from "npm:postgres@3.4.5";

const dbURL = Deno.env.get("PANE_DB_URL");
const me = Deno.env.get("PANE_USER_JWT");
const enabled = Boolean(dbURL && me && /127\.0\.0\.1/.test(dbURL ?? ""));
const sub = (jwt: string) => JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub as string;
const migration = new URL("../../migrations/20260929230000_tip_events.sql", import.meta.url);

class Rollback extends Error {}
type Tx = postgres.TransactionSql;

async function scratch(body: (tx: Tx, user: string) => Promise<void>) {
  const sql = postgres(dbURL!, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      const [{ applied }] = await tx`select to_regprocedure('public.pane_tip_event(text, text)') is not null as applied`;
      if (!applied) await tx.unsafe(await Deno.readTextFile(migration));
      const user = sub(me!);
      await tx`delete from public.pane_rate where user_id = ${user}`;
      await tx`set local role authenticated`;
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: user, role: "authenticated" })}, true)`;
      await body(tx, user);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  } finally {
    await sql.end();
  }
}

Deno.test({ name: "tips: shown and used are counted per tip and day, for the signed-in account", ignore: !enabled }, async () => {
  await scratch(async (tx, user) => {
    await tx`select public.pane_tip_event('versionHistory', 'shown')`;
    await tx`select public.pane_tip_event('versionHistory', 'shown')`;
    await tx`select public.pane_tip_event('versionHistory', 'used')`;
    await tx`select public.pane_tip_event('shareLink', 'shown')`;
    const rows = await tx`select tip, event, n from public.pane_tip_activity where user_id = ${user} order by tip, event`;
    assertEquals(rows.map((r) => [r.tip, r.event, r.n]), [["shareLink", "shown", 1], ["versionHistory", "shown", 2], ["versionHistory", "used", 1]]);
  });
});

Deno.test({ name: "tips: unknown tips and events are refused, and nobody writes the table directly", ignore: !enabled }, async () => {
  await scratch(async (tx, user) => {
    let message = "";
    await tx.savepoint((sp) => sp`select public.pane_tip_event('checklistTidy', 'shown')`).catch((e) => { message = e.message; });
    assertStringIncludes(message, "pane_tip_activity_tip_check");
    message = "";
    await tx.savepoint((sp) => sp`select public.pane_tip_event('shareLink', 'clicked')`).catch((e) => { message = e.message; });
    assertStringIncludes(message, "pane_tip_activity_event_check");
    message = "";
    await tx.savepoint((sp) => sp`insert into public.pane_tip_activity (user_id, day, tip, event, n) values (${user}, current_date, 'shareLink', 'used', 99)`)
      .catch((e) => { message = e.message; });
    assertStringIncludes(message, "permission denied");
  });
});

Deno.test({ name: "tips: the report is for the service role only", ignore: !enabled }, async () => {
  await scratch(async (tx, user) => {
    await tx`select public.pane_tip_event('menuBar', 'shown')`;
    await tx`select public.pane_tip_event('menuBar', 'used')`;
    let message = "";
    await tx.savepoint((sp) => sp`select * from public.pane_tip_report(30)`).catch((e) => { message = e.message; });
    assertStringIncludes(message, "permission denied");
    await tx`reset role`;
    await tx`set local role service_role`;
    const rows = await tx`select * from public.pane_tip_report(30) where tip = 'menuBar'`;
    const mine = await tx`select count(*)::int as n from public.pane_tip_activity where user_id = ${user} and tip = 'menuBar'`;
    assertEquals(mine[0].n, 2);
    assertEquals(Number(rows[0].shown_accounts) >= 1, true);
    assertEquals(Number(rows[0].used_accounts) >= 1, true);
  });
});

Deno.test({ name: "features used: a flag, any share link ever, or a version restored from an app", ignore: !enabled }, async () => {
  await scratch(async (tx, user) => {
    assertEquals((await tx`select public.pane_features_used() as f`)[0].f, []);
    await tx`select public.pane_feature_used('menuBar')`;
    await tx`select public.pane_feature_used('menuBar')`;
    assertEquals((await tx`select public.pane_features_used() as f`)[0].f, ["menuBar"]);
    await tx`reset role`;
    const note = crypto.randomUUID();
    await tx`insert into public.notes (id, user_id, body) values (${note}, ${user}, 'Shared')`;
    await tx`insert into public.note_shares (slug, note_id, user_id, revoked_at) values (${"s" + crypto.randomUUID().replaceAll("-", "")}, ${note}, ${user}, now())`;
    // An AI's restore isn't yours; one from an app is.
    await tx`insert into public.note_revisions (note_id, user_id, body, version, source, client) values (${note}, ${user}, 'a', 1, 'restore', 'ChatGPT')`;
    await tx`set local role authenticated`;
    assertEquals((await tx`select public.pane_features_used() as f`)[0].f, ["menuBar", "shareLink"]);
    await tx`reset role`;
    await tx`insert into public.note_revisions (note_id, user_id, body, version, source, client) values (${note}, ${user}, 'b', 2, 'restore', 'iPhone')`;
    await tx`set local role authenticated`;
    assertEquals((await tx`select public.pane_features_used() as f`)[0].f, ["menuBar", "shareLink", "versionHistory"]);
    let message = "";
    await tx.savepoint((sp) => sp`select public.pane_feature_used('checklistTidy')`).catch((e) => { message = e.message; });
    assertStringIncludes(message, "pane_feature_use_feature_check");
  });
});
