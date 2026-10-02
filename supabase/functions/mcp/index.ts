// Amber Notes's MCP server, served as a Supabase edge function. Everything is in server.ts.

import { connect, readiness } from "../_shared/db.ts";
import { handleRequest } from "./server.ts";

// Through the transaction pooler when DB_POOLER_HOST is set (_shared/db.ts says why).
const sql = connect(Deno.env, 3);
const ready = readiness(sql);

Deno.serve(async (req) => {
  await ready();
  return handleRequest(req, sql);
});
