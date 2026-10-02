import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const calls: { url: string; init: RequestInit }[] = [];
let answer: { status: number; body: unknown } = { status: 200, body: { exists: true, password: true } };

beforeEach(() => {
  calls.length = 0;
  vi.stubEnv("SUPABASE_URL", "https://ref.supabase.co");
  vi.stubEnv("SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("MCP_PROXY_SECRET", "secret");
  vi.stubEnv("FUNCTION_REGION", "eu-central-1");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const ask = (body: unknown, headers: Record<string, string> = { origin: "https://ambernotes.app", host: "ambernotes.app", "x-real-ip": "198.51.100.7" }) =>
  POST(new Request("https://ambernotes.app/connect/account-status", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

describe("/connect/account-status", () => {
  it("asks the function for the visitor, and passes back only whether there's an account and a password", async () => {
    answer = { status: 200, body: { exists: true, password: false, extra: "never passed on" } };
    const res = await ask({ email: "sara@example.com" });
    expect([res.status, await res.json()]).toEqual([200, { exists: true, password: false }]);
    expect(calls[0].url).toBe("https://ref.supabase.co/functions/v1/account-status");
    const h = new Headers(calls[0].init.headers);
    expect([h.get("x-mcp-client-ip"), h.get("x-mcp-proxy-secret"), h.get("x-region"), h.get("authorization")]).toEqual(["198.51.100.7", "secret", "eu-central-1", "Bearer anon"]);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ email: "sara@example.com" });
  });

  it("answers only the connect page itself", async () => {
    expect((await ask({ email: "a@b.co" }, { origin: "https://evil.example", host: "ambernotes.app" })).status).toBe(403);
    expect((await ask({ email: "a@b.co" }, { host: "ambernotes.app" })).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("passes the function's limit on, and says nothing when the function can't answer", async () => {
    answer = { status: 429, body: { error: "slow down" } };
    expect((await ask({ email: "a@b.co" })).status).toBe(429);
    answer = { status: 500, body: { error: "unavailable" } };
    const res = await ask({ email: "a@b.co" });
    expect([res.status, await res.json()]).toEqual([502, { error: "unavailable" }]);
    expect((await ask({ email: 7 })).status).toBe(400);
  });
});
