import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { middleware } from "./middleware";
import nextConfig from "./next.config";

const SUPABASE = "https://ref.supabase.co";
const FN = `${SUPABASE}/functions/v1/mcp`;
const env = ["SUPABASE_URL", "MCP_PROXY_SECRET", "__NEXT_NO_MIDDLEWARE_URL_NORMALIZE"] as const;
const saved = Object.fromEntries(env.map((k) => [k, process.env[k]]));

beforeAll(() => {
  process.env.SUPABASE_URL = SUPABASE;
  process.env.MCP_PROXY_SECRET = "test-secret";
  // What next build does with next.config.ts (define-env), so NextRequest behaves as in production.
  if (nextConfig.skipMiddlewareUrlNormalize) process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE = "true";
});

afterAll(() => {
  for (const k of env) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/// Where the proxy sends a request to mcp.ambernotes.app, or null if it doesn't.
async function proxied(pathAndQuery: string): Promise<string | null> {
  const req = new NextRequest(`https://mcp.ambernotes.app${pathAndQuery}`, { headers: { host: "mcp.ambernotes.app" } });
  const res = await middleware(req);
  return res.headers.get("x-middleware-rewrite");
}

const challenge = "code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256";

describe("the MCP proxy", () => {
  it("forwards a 127.0.0.1 redirect_uri exactly as sent", async () => {
    const query = `?response_type=code&client_id=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A53682%2Fcallback&${challenge}`;
    expect(await proxied(`/authorize${query}`)).toBe(`${FN}/authorize${query}`);
  });

  it("forwards a [::1] redirect_uri exactly as sent", async () => {
    const query = `?response_type=code&client_id=abc&redirect_uri=http%3A%2F%2F%5B%3A%3A1%5D%3A33418%2F&${challenge}`;
    expect(await proxied(`/authorize${query}`)).toBe(`${FN}/authorize${query}`);
  });

  it("forwards unencoded loopback addresses in the query exactly as sent", async () => {
    for (const query of ["?redirect_uri=http://127.0.0.1/callback&state=[::1]", "?redirect_uri=http://[::1]:33418/&state=x"]) {
      expect(await proxied(`/authorize${query}`)).toBe(`${FN}/authorize${query}`);
    }
  });

  it("keeps the query on the token endpoint too", async () => {
    expect(await proxied("/token?redirect_uri=http%3A%2F%2F127.0.0.1%3A1%2F")).toBe(`${FN}/token?redirect_uri=http%3A%2F%2F127.0.0.1%3A1%2F`);
  });

  it("maps the root to the function itself", async () => {
    expect(await proxied("/")).toBe(FN);
  });

  it("never forwards paths the server doesn't have", async () => {
    expect(await proxied("/admin?redirect_uri=http%3A%2F%2F127.0.0.1%2F")).toBeNull();
    expect(await proxied("/connect%2f..%2fadmin")).toBeNull();
  });
});

describe("the connect pages' CSP", () => {
  const csp = async (path: string) =>
    (await middleware(new NextRequest(`https://ambernotes.app${path}`, { headers: { host: "ambernotes.app" } }))).headers.get("content-security-policy") ?? "";

  it("lets /connect call the Supabase project", async () => {
    expect(await csp(`/connect?request=5a0f6c1e-2b1d-4c36-9e0a-6b6f0c1a2b3c`)).toContain(`connect-src 'self' ${SUPABASE};`);
  });

  it("keeps /open/connect to this site", async () => {
    const policy = await csp(`/open/connect?request=5a0f6c1e-2b1d-4c36-9e0a-6b6f0c1a2b3c`);
    expect(policy).toContain("connect-src 'self';");
    expect(policy).not.toContain(SUPABASE);
  });
});
