// The fetch-based MCP client against a tiny server that answers like the spec allows: JSON or an
// event stream, a session id, and 401 for a bad token.
import { assertEquals, assertRejects } from "@std/assert";
import { connect, Refused, ToolFailed } from "./client.ts";

function serve(sse: boolean) {
  const seen: { method: string; session: string | null; version: string | null }[] = [];
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, async (req) => {
    if (req.method === "DELETE") return new Response(null, { status: 204 });
    if (req.headers.get("authorization") !== "Bearer good") return Response.json({ error: "x" }, { status: 401 });
    const m = await req.json();
    seen.push({ method: m.method, session: req.headers.get("mcp-session-id"), version: req.headers.get("mcp-protocol-version") });
    if (m.id === undefined) return new Response(null, { status: 202 });
    const result = m.method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "t", version: "1" } }
      : m.method === "tools/list" ? (m.params?.cursor ? { tools: [{ name: "fetch" }] } : { tools: [{ name: "search" }], nextCursor: "2" })
      : m.params.name === "search" ? { content: [{ type: "text", text: "{}" }], structuredContent: { results: [{ path: "A.md" }] } }
      : { content: [{ type: "text", text: "No note at \"B.md\"." }], isError: true };
    const body = JSON.stringify({ jsonrpc: "2.0", id: m.id, result });
    const headers = { "mcp-session-id": "s1" };
    return sse
      ? new Response(`event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\nevent: message\ndata: ${body}\n\n`, { headers: { ...headers, "content-type": "text/event-stream" } })
      : new Response(body, { headers: { ...headers, "content-type": "application/json" } });
  });
  return { url: `http://127.0.0.1:${server.addr.port}/mcp`, seen, server };
}

for (const sse of [false, true]) {
  Deno.test(`tools over ${sse ? "an event stream" : "JSON"}: list (paged), call, errors`, async () => {
    const s = serve(sse);
    try {
      const mcp = await connect(s.url, () => Promise.resolve("good"));
      assertEquals(mcp.tools, ["search", "fetch"]);
      assertEquals(await mcp.call("search", { query: "a" }), { results: [{ path: "A.md" }] });
      await assertRejects(() => mcp.call("fetch", { id: "B.md" }), ToolFailed, "No note at");
      await mcp.close();
      assertEquals(s.seen.map((x) => x.method), ["initialize", "notifications/initialized", "tools/list", "tools/list", "tools/call", "tools/call"]);
      assertEquals(s.seen[2], { method: "tools/list", session: "s1", version: "2025-06-18" });
    } finally {
      await s.server.shutdown();
    }
  });
}

Deno.test("a refused token is retried once with a fresh one", async () => {
  const s = serve(false);
  try {
    const asked: boolean[] = [];
    const mcp = await connect(s.url, (force) => { asked.push(force); return Promise.resolve(force ? "good" : "stale"); });
    assertEquals(asked, [false, true]);
    assertEquals(mcp.tools.length, 2);
    await assertRejects(() => connect(s.url, () => Promise.resolve("bad")), Refused);
  } finally {
    await s.server.shutdown();
  }
});
