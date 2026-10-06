// A plain MCP client over streamable HTTP (the official SDK), calling the connector's tools. The
// token rides in the Authorization header and never reaches a log line or an error message.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const VERSION = "0.2.0";

/** A tool answered with an error (no such note, old_text not found, …): its message is for people. */
export class ToolFailed extends Error {}
/** The server turned the token away. */
export class Refused extends Error {}

export type Mcp = { tools: string[]; call(name: string, args?: Record<string, unknown>): Promise<any>; close(): Promise<void> };

/** Any token-shaped text in `s`, hidden. */
export const redact = (s: string) => s.replace(/\b(pane|amb_at|amb_rt|amb_code)_[0-9a-f]{6,}/gi, "$1_…");

const refused = (e: unknown) => /\b401\b|-32001|unauthori[sz]ed|invalid_token|Sign in to Amber Notes/i.test(String((e as Error)?.message ?? e));

async function open(server: string, token: string): Promise<Mcp> {
  const transport = new StreamableHTTPClientTransport(new URL(server), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  const client = new Client({ name: "amber-cli", version: VERSION });
  try {
    await client.connect(transport);
  } catch (e) {
    if (refused(e)) throw new Refused("refused");
    throw new Error(`Couldn't reach ${server}: ${redact(String((e as Error)?.message ?? e))}`);
  }
  const tools = (await client.listTools()).tools.map((t: { name: string }) => t.name);
  return {
    tools,
    async call(name, args = {}) {
      let r;
      try {
        r = await client.callTool({ name, arguments: args });
      } catch (e) {
        if (refused(e)) throw new Refused("refused");
        throw new Error(`${name}: ${redact(String((e as Error)?.message ?? e))}`);
      }
      const text = (r.content as { type: string; text?: string }[] | undefined)?.find((c) => c.type === "text")?.text ?? "";
      if (r.isError) throw new ToolFailed(text);
      if (r.structuredContent) return r.structuredContent;
      try { return JSON.parse(text); } catch { return text; }
    },
    close: () => client.close(),
  };
}

/** Connects with `token(false)`; turned away, tries once more with `token(true)` (a refreshed one). */
export async function connect(server: string, token: (force: boolean) => Promise<string>): Promise<Mcp> {
  try {
    return await open(server, await token(false));
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    return await open(server, await token(true));
  }
}
