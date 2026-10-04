import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const calls: { url: string; init: RequestInit }[] = [];
let answer: { status: number; body: unknown } | "offline" = { status: 200, body: {} };

beforeEach(() => {
  calls.length = 0;
  answer = { status: 200, body: {} };
  vi.stubEnv("SUPABASE_URL", "https://ref.supabase.co/");
  vi.stubEnv("SUPABASE_ANON_KEY", "anon");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (answer === "offline") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  }));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const ask = (body: unknown, headers: Record<string, string> = { origin: "https://ambernotes.app", host: "ambernotes.app" }) =>
  POST(new Request("https://ambernotes.app/reset-password/request", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

describe("/reset-password/request", () => {
  it("asks Supabase Auth for a recovery email, with no redirect and no PKCE challenge", async () => {
    const res = await ask({ email: " sara@example.com " });
    expect([res.status, await res.json()]).toEqual([200, { sent: true }]);
    expect(calls[0].url).toBe("https://ref.supabase.co/auth/v1/recover");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ email: "sara@example.com" });
    const h = new Headers(calls[0].init.headers);
    expect([h.get("apikey"), h.get("authorization")]).toEqual(["anon", "Bearer anon"]);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers the same whether or not an account uses the email", async () => {
    // Supabase's answers that only a known address can get: the per-address and hourly limits, a mail that didn't go.
    const answers = [
      { status: 200, body: {} },
      { status: 429, body: { error_code: "over_email_send_rate_limit" } },
      { status: 500, body: { error_code: "unexpected_failure", msg: "Error sending recovery email" } },
      { status: 400, body: { error_code: "validation_failed" } },
    ];
    const replies = [];
    for (const a of answers) {
      answer = a;
      const res = await ask({ email: "sara@example.com" });
      replies.push([res.status, await res.json()]);
    }
    expect(replies).toEqual(answers.map(() => [200, { sent: true }]));
  });

  it("never logs the address", async () => {
    answer = { status: 429, body: {} };
    await ask({ email: "sara@example.com" });
    expect(String(vi.mocked(console.warn).mock.calls)).not.toContain("sara");
  });

  it("answers only the reset page itself", async () => {
    expect((await ask({ email: "a@b.co" }, { origin: "https://evil.example", host: "ambernotes.app" })).status).toBe(403);
    expect((await ask({ email: "a@b.co" }, { host: "ambernotes.app" })).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("turns away what isn't an email before asking", async () => {
    for (const email of ["sara", 7, "a".repeat(320) + "@b.co", ""]) expect((await ask({ email })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("says so when Supabase can't be reached, or isn't configured", async () => {
    answer = "offline";
    expect((await ask({ email: "a@b.co" })).status).toBe(502);
    vi.stubEnv("SUPABASE_ANON_KEY", "");
    expect((await ask({ email: "a@b.co" })).status).toBe(503);
  });
});
