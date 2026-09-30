// Amber Notes's MCP server, served as a Supabase edge function. Everything is in server.ts.

import postgres from "npm:postgres@3.4.5";
import { handleRequest } from "./server.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 3, idle_timeout: 20, prepare: false });

Deno.serve((req) => handleRequest(req, sql));
