// A small MCP client over streamable HTTP, on fetch: initialize, tools/list and tools/call, as
// JSON-RPC in POST requests, answered as JSON or as a server-sent event stream (both are in the
// spec; the Amber Notes server answers JSON). The token rides in the Authorization header and never
// reaches a log line or an error message.
export const VERSION = "0.2.0";
const PROTOCOL = "2025-06-18";

/** A tool answered with an error (no such note, old_text not found, …): its message is for people. */
export class ToolFailed extends Error {}
/** The server turned the token away. */
export class Refused extends Error {}

export type Mcp = { tools: string[]; call(name: string, args?: Record<string, unknown>): Promise<any>; close(): Promise<void> };

/** Any token-shaped text in `s`, hidden. */
export const redact = (s: string) => s.replace(/\b(pane|amb_at|amb_rt|amb_code)_[0-9a-f]{6,}/gi, "$1_…");

type Rpc = { jsonrpc: "2.0"; id?: number; result?: any; error?: { code: number; message: string } };

/** The JSON-RPC answer with `id` from a JSON body or an event stream. */
async function answer(res: Response, id: number): Promise<Rpc | null> {
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("text/event-stream")) {
    const text = await res.text();
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
      if (!data) continue;
      const m = JSON.parse(data) as Rpc;
      if (m.id === id) return m;
    }
    return null;
  }
  const body = await res.text();
  if (!body.trim()) return null;
  const m = JSON.parse(body);
  return Array.isArray(m) ? m.find((x: Rpc) => x.id === id) ?? null : m;
}

async function open(server: string, token: string): Promise<Mcp> {
  let session: string | null = null;
  let version = PROTOCOL;
  let next = 0;
  const post = async (method: string, params?: Record<string, unknown>, notify = false): Promise<any> => {
    const id = ++next;
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" };
    if (session) headers["mcp-session-id"] = session;
    if (method !== "initialize") headers["mcp-protocol-version"] = version;
    let res: Response;
    try {
      res = await fetch(server, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", ...(notify ? {} : { id }), method, ...(params ? { params } : {}) }) });
    } catch (e) {
      throw new Error(`Couldn't reach ${server}: ${redact((e as Error).message)}`);
    }
    if (res.status === 401 || res.status === 403) { await res.body?.cancel(); throw new Refused("refused"); }
    session = res.headers.get("mcp-session-id") ?? session;
    if (notify) { await res.body?.cancel(); return; }
    if (!res.ok) throw new Error(`${server} answered ${res.status} to ${method}: ${redact((await res.text()).slice(0, 200))}`);
    const m = await answer(res, id);
    if (!m) throw new Error(`${server} sent no answer to ${method}.`);
    if (m.error) throw new Error(`${method}: ${redact(m.error.message)}`);
    return m.result;
  };

  const init = await post("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "amber-cli", version: VERSION } });
  version = init?.protocolVersion ?? PROTOCOL;
  await post("notifications/initialized", undefined, true);
  const tools: string[] = [];
  for (let cursor: string | undefined, i = 0; i < 20; i++) {
    const r = await post("tools/list", cursor ? { cursor } : undefined);
    tools.push(...(r.tools ?? []).map((t: { name: string }) => t.name));
    cursor = r.nextCursor;
    if (!cursor) break;
  }
  return {
    tools,
    async call(name, args = {}) {
      const r = await post("tools/call", { name, arguments: args });
      const text = (r.content as { type: string; text?: string }[] | undefined)?.find((c) => c.type === "text")?.text ?? "";
      if (r.isError) throw new ToolFailed(text);
      if (r.structuredContent) return r.structuredContent;
      try { return JSON.parse(text); } catch { return text; }
    },
    // Ends the session where the server keeps one (DELETE, as the spec says); fine if it doesn't.
    async close() {
      if (!session) return;
      await fetch(server, { method: "DELETE", headers: { authorization: `Bearer ${token}`, "mcp-session-id": session } }).then((r) => r.body?.cancel()).catch(() => {});
    },
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
