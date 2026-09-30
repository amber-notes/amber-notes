// After deploying the website and the MCP function: checks mcp.ambernotes.app and the consent page
// from the outside, the way a directory reviewer's client sees them. Read-only: it creates nothing.
//
//   deno run -A scripts/check-mcp-domain.ts [supabase-ref]     # default: the production project
//
// A failure on the first two checks usually means MCP_PROXY_SECRET differs between Vercel and the
// function (or is missing on one side): the function then ignores the proxy and names its own address.
const REF = Deno.args[0] ?? "rodegaeruhyybqilrnpn";
const MCP = "https://mcp.ambernotes.app";
const FUNCTION = `https://${REF}.supabase.co/functions/v1/mcp`;
const SITE = "https://ambernotes.app";

let failed = 0;
async function check(name: string, fn: () => Promise<string | void>) {
  try {
    const note = await fn();
    console.log(`ok    ${name}${note ? `  (${note})` : ""}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}: ${(e as Error).message}`);
  }
}
function expect(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}
const get = (url: string, init: RequestInit = {}) => fetch(url, { redirect: "manual", ...init });

await check("authorization server metadata names mcp.ambernotes.app everywhere", async () => {
  const res = await get(`${MCP}/.well-known/oauth-authorization-server`);
  expect(res.status === 200, `status ${res.status}${res.status === 503 ? " (the proxy has no MCP_PROXY_SECRET or SUPABASE_URL)" : ""}`);
  const m = await res.json();
  expect(m.issuer === MCP, `issuer is ${m.issuer}`);
  for (const k of ["authorization_endpoint", "token_endpoint", "registration_endpoint", "revocation_endpoint"]) {
    expect(String(m[k]).startsWith(`${MCP}/`), `${k} is ${m[k]}`);
  }
});

await check("protected resource metadata names mcp.ambernotes.app", async () => {
  const m = await (await get(`${MCP}/.well-known/oauth-protected-resource`)).json();
  expect(m.resource === MCP, `resource is ${m.resource}`);
  expect(JSON.stringify(m.authorization_servers) === JSON.stringify([MCP]), `authorization_servers ${JSON.stringify(m.authorization_servers)}`);
});

await check("an unauthenticated MCP request gets 401 pointing at the metadata", async () => {
  const res = await get(MCP, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "check", version: "1" } } }),
  });
  await res.body?.cancel();
  expect(res.status === 401, `status ${res.status}`);
  const h = res.headers.get("www-authenticate") ?? "";
  expect(h.includes(`resource_metadata="${MCP}/.well-known/oauth-protected-resource"`), `www-authenticate: ${h}`);
});

await check("CORS preflight goes through", async () => {
  const res = await get(MCP, { method: "OPTIONS", headers: { origin: "https://claude.ai", "access-control-request-method": "POST", "access-control-request-headers": "authorization, content-type, mcp-protocol-version" } });
  await res.body?.cancel();
  expect(res.status === 204 || res.status === 200, `status ${res.status}`);
  expect((res.headers.get("access-control-allow-headers") ?? "").includes("mcp-protocol-version"), "allow-headers missing mcp-protocol-version");
});

await check("/authorize for an unknown app ends on our own page", async () => {
  const res = await get(`${MCP}/authorize?response_type=code&client_id=amb_client_nope&redirect_uri=https%3A%2F%2Fevil.example%2Fcb&code_challenge=${"a".repeat(43)}&code_challenge_method=S256`);
  await res.body?.cancel();
  const to = res.headers.get("location") ?? "";
  expect(res.status === 302 && to === `${SITE}/connect?problem=unknown_app`, `status ${res.status}, location ${to}`);
});

await check("only the server's own paths are proxied", async () => {
  for (const path of ["/account", "/..%2faccount", "/authorize%2f..%2f..%2faccount", "/%5c..%5caccount", "/connect/decide/x"]) {
    const res = await get(`${MCP}${path}`);
    await res.body?.cancel();
    expect(res.status === 404, `${path}: status ${res.status}`);
  }
});

await check("the old supabase.co address still answers as itself", async () => {
  const m = await (await get(`${FUNCTION}/.well-known/oauth-authorization-server`)).json();
  expect(m.issuer === FUNCTION, `issuer is ${m.issuer}`);
});

await check("the function ignores a proxy header without the secret", async () => {
  const m = await (await get(`${FUNCTION}/.well-known/oauth-protected-resource`, { headers: { "x-mcp-public-url": MCP } })).json();
  expect(m.resource === FUNCTION, `resource is ${m.resource}`);
});

await check("the consent page loads with a nonce CSP and no unsafe-inline", async () => {
  const res = await get(`${SITE}/connect?request=00000000-0000-4000-8000-000000000000`);
  const html = await res.text();
  expect(res.status === 200, `status ${res.status}`);
  const csp = res.headers.get("content-security-policy") ?? "";
  expect(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/.test(csp), `CSP: ${csp}`);
  expect(!csp.includes("unsafe-inline"), `CSP allows unsafe-inline: ${csp}`);
  expect(csp.includes(`https://${REF}.supabase.co`), "CSP doesn't allow the Supabase project");
  expect(html.includes("Connect an app to Amber Notes"), "the page doesn't show the sign-in");
  expect(res.headers.get("x-robots-tag")?.includes("noindex"), "no noindex");
});

await check("the old vercel.app address sends /connect to ambernotes.app", async () => {
  const res = await get("https://amber-notes.vercel.app/connect?request=00000000-0000-4000-8000-000000000000");
  await res.body?.cancel();
  const to = res.headers.get("location") ?? "";
  expect([301, 307, 308].includes(res.status) && to.startsWith(`${SITE}/connect`), `status ${res.status}, location ${to}`);
});

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
Deno.exit(failed ? 1 : 0);
