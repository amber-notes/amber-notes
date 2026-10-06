// A plain MCP client over streamable HTTP (the official SDK), signed in with an Amber Notes token
// sent as `Authorization: Bearer pane_…`. The token never reaches a log line or an error message.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const VERSION = "0.1.0";

/** A tool answered with an error (a note that changed since, a path that doesn't exist, …). */
export class ToolFailed extends Error {}

export type Mcp = { tools: string[]; call(name: string, args?: Record<string, unknown>): Promise<any>; close(): Promise<void> };

/** Any token-shaped text in `s`, hidden. */
export const redact = (s: string) => s.replace(/\b(pane|amb_at|amb_rt)_[0-9a-f]{6,}/gi, "$1_…");

const REFUSED = "The server refused the token. Make a new one in Amber Notes (Settings › Connect an AI), then run `amber login`.";

export async function connect(server: string, token: string): Promise<Mcp> {
  const transport = new StreamableHTTPClientTransport(new URL(server), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  const client = new Client({ name: "amber-cli", version: VERSION });
  try {
    await client.connect(transport);
  } catch (e) {
    const msg = redact(String((e as Error)?.message ?? e));
    if (/401|unauthori[sz]ed|invalid_token/i.test(msg)) throw new Error(REFUSED);
    throw new Error(`Couldn't reach ${server}: ${msg}`);
  }
  const tools = (await client.listTools()).tools.map((t: { name: string }) => t.name);
  return {
    tools,
    async call(name, args = {}) {
      let r;
      try {
        r = await client.callTool({ name, arguments: args });
      } catch (e) {
        const msg = redact(String((e as Error)?.message ?? e));
        if (/401|unauthori[sz]ed/i.test(msg)) throw new Error(REFUSED);
        throw new Error(`${name}: ${msg}`);
      }
      const text = (r.content as { type: string; text?: string }[] | undefined)?.find((c) => c.type === "text")?.text ?? "";
      if (r.isError) throw new ToolFailed(text);
      if (r.structuredContent) return r.structuredContent;
      try { return JSON.parse(text); } catch { return text; }
    },
    close: () => client.close(),
  };
}
