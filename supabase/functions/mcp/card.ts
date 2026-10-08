// The server card at /.well-known/mcp/server-card.json: what the server is and which tools it has,
// readable without signing in. Directories such as Smithery read it when they can't sign in to list
// the tools themselves. Built from the same tool list the server serves, so it can't drift.

import { tools } from "./tools.ts";

export const SERVER_INFO = { name: "amber-notes", title: "Pinto Notes", version: "1.0.0" };
// Joined at runtime: the Supabase CLI mistakes a literal "/….json" path for a static file to bundle.
export const SERVER_CARD_PATH = ["", ".well-known", "mcp", "server-card.json"].join("/");

export function serverCard() {
  return {
    serverInfo: SERVER_INFO,
    description: "Search, read and edit your notes in Pinto Notes, the notes app for iPhone and Mac. You choose read only or read and edit when you connect, and every change keeps the previous version.",
    homepage: "https://ambernotes.app/blog/mcp-server",
    authentication: { required: true, schemes: ["oauth2"] },
    tools: tools.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })),
    resources: [],
    prompts: [],
  };
}

export function serverCardResponse(): Response {
  return new Response(JSON.stringify(serverCard()), {
    headers: { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "public, max-age=3600" },
  });
}
