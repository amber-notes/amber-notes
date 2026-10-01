// The developers' share ask (20261001120000_open_source_ask.sql) on the whole schema in PGlite.
//   cd supabase/functions/mcp && deno test -A open_source_ask.pglite.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { asUser, newUser, schemaDB } from "./pglite.ts";

const hex = () => [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
const state = async (pg: PGlite, me: string) => (await asUser<any>(pg, me, `select public.pane_share_ask_state() as s`))[0].s;
const connect = (pg: PGlite, me: string, kind: "token" | "oauth", host: string | null, revoked = false) =>
  pg.query(`insert into public.mcp_tokens (user_id, name, token_hash, can_write, kind, redirect_host, revoked_at) values ($1, 'x', $2, true, $3, $4, $5)`,
    [me, hex(), kind, host, revoked ? new Date() : null]);

Deno.test("developers are accounts that ever connected a tool on this computer or with a token", async () => {
  const pg = await schemaDB();
  const cases: [string, (me: string) => Promise<unknown>, boolean][] = [
    ["no connections", async () => {}, false],
    ["ChatGPT on the web", (me) => connect(pg, me, "oauth", "chatgpt.com"), false],
    ["Claude on the web", (me) => connect(pg, me, "oauth", "claude.ai"), false],
    ["an access token (Claude Code, Codex)", (me) => connect(pg, me, "token", null), true],
    ["a loopback sign-in (Gemini CLI, Incredible)", (me) => connect(pg, me, "oauth", "127.0.0.1"), true],
    ["localhost", (me) => connect(pg, me, "oauth", "localhost"), true],
    ["IPv6 loopback", (me) => connect(pg, me, "oauth", "[::1]"), true],
    ["a token since disconnected", (me) => connect(pg, me, "token", null, true), true],
  ];
  for (const [what, setUp, developer] of cases) {
    const me = await newUser(pg);
    await setUp(me);
    assertEquals((await state(pg, me)).developer, developer, what);
  }
});

Deno.test("starring on GitHub is an answer like the others, kept once and counted", async () => {
  const pg = await schemaDB();
  const me = await newUser(pg);
  await asUser(pg, me, `select public.pane_share_ask_decide('starred_github')`);
  await asUser(pg, me, `select public.pane_share_ask_decide('dismissed')`);
  assertEquals((await pg.query<any>(`select choice from public.pane_share_ask where user_id = $1`, [me])).rows, [{ choice: "starred_github" }]);
  assertEquals((await state(pg, me)).decided, true);
  await asUser(pg, me, `select public.pane_tip_event('shareAsk', 'starred_github')`);
  const [report] = (await pg.query<any>(`select * from public.pane_share_ask_report(30)`)).rows;
  assertEquals(Number(report.starred_github), 1);
});
