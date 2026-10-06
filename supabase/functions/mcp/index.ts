// Amber Notes's MCP server, served as a Supabase edge function. Everything is in server.ts.

import { connect, readiness } from "../_shared/db.ts";
import { atHome } from "../_shared/region.ts";
import { handleRequest, needsDatabase } from "./server.ts";

// Through the transaction pooler when DB_POOLER_HOST is set (_shared/db.ts says why).
const sql = connect(Deno.env, 3);
const ready = readiness(sql);

// Wherever a request lands, the work happens in the home region (_shared/region.ts).
Deno.serve(atHome("mcp", async (req) => {
  const t = performance.now();
  if (needsDatabase(req)) await ready();
  const waited = performance.now() - t;
  const res = await handleRequest(req, sql);
  // How long the database check took (a new connection's first query), for Server-Timing.
  const timing = res.headers.get("server-timing");
  if (timing) res.headers.set("server-timing", `${timing}, db_ready;dur=${Math.round(waited)}`);
  return res;
}));
