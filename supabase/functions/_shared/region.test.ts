import { assert, assertEquals } from "jsr:@std/assert@1";
import { clientAddress } from "./client.ts";
import { atHome, fromRelay, here, homeRegion, homeURL, REGION_HEADER, RELAY_HEADER, relayHeaders, shouldRelay } from "./region.ts";

const REF = "abcdefghijklmnopqrst";
const env = (vars: Record<string, string>) => ({ get: (k: string) => vars[k] });
const BASE = { SUPABASE_URL: `https://${REF}.supabase.co`, MCP_PROXY_SECRET: "proxy-secret", FUNCTION_REGION: "eu-central-1" };
const away = env({ ...BASE, SB_REGION: "us-east-1" });
const home = env({ ...BASE, SB_REGION: "eu-central-1" });
const req = (path: string, init: RequestInit = {}) => new Request(`https://${REF}.supabase.co/functions/v1${path}`, init);
const quiet = async <T>(run: () => Promise<T>): Promise<{ value: T; lines: Record<string, unknown>[] }> => {
  const lines: Record<string, unknown>[] = [];
  const real = console.log;
  console.log = (s: string) => lines.push(JSON.parse(s));
  try { return { value: await run(), lines }; } finally { console.log = real; }
};

Deno.test("a request is handed on only from another region, with a home region and the secret set, and never twice", () => {
  assertEquals([homeRegion(home), here(home), here(away)], ["eu-central-1", "eu-central-1", "us-east-1"]);
  assert(shouldRelay(req("/mcp", { method: "POST" }), away));
  assert(shouldRelay(req("/mcp/connect/status", { method: "POST" }), env({ ...BASE, SB_REGION: "ap-southeast-1" })));
  // At home, with no home region set, on a local stack, or without the secret: answered here.
  assert(!shouldRelay(req("/mcp", { method: "POST" }), home));
  assert(!shouldRelay(req("/mcp"), env({ ...BASE, FUNCTION_REGION: "", SB_REGION: "us-east-1" })));
  assert(!shouldRelay(req("/mcp"), env({ ...BASE, FUNCTION_REGION: "Frankfurt; drop", SB_REGION: "us-east-1" })));
  assert(!shouldRelay(req("/mcp"), env({ ...BASE })));
  assert(!shouldRelay(req("/mcp"), env({ ...BASE, MCP_PROXY_SECRET: "", SB_REGION: "us-east-1" })));
  // A request a relay already sent (the mark, under the secret), and a preflight.
  assert(!shouldRelay(req("/mcp", { headers: { [RELAY_HEADER]: "us-east-1", "x-mcp-proxy-secret": "proxy-secret" } }), away));
  assert(!shouldRelay(req("/mcp", { method: "OPTIONS" }), away));
  // The mark alone is anyone's to send: it doesn't keep a request out of home.
  assert(shouldRelay(req("/mcp", { method: "POST", headers: { [RELAY_HEADER]: "1" } }), away));
  assert(shouldRelay(req("/mcp", { method: "POST", headers: { [RELAY_HEADER]: "1", "x-mcp-proxy-secret": "guess" } }), away));
  assert(!fromRelay(req("/mcp", { headers: { [RELAY_HEADER]: "1", "x-mcp-proxy-secret": "" } }), env({ ...BASE, MCP_PROXY_SECRET: "", SB_REGION: "us-east-1" })));
});

Deno.test("it goes to the same function and path at the project's address, query and all", () => {
  const base = `https://${REF}.supabase.co`;
  assertEquals(homeURL(req("/mcp"), "mcp", base), `${base}/functions/v1/mcp`);
  assertEquals(homeURL(req("/mcp/connect/request?id=1"), "mcp", base + "/"), `${base}/functions/v1/mcp/connect/request?id=1`);
  // Inside the runtime the path can arrive without /functions/v1.
  assertEquals(homeURL(new Request("http://localhost:9000/share-files?slug=a&sub=b"), "share-files", base), `${base}/functions/v1/share-files?slug=a&sub=b`);
  assertEquals(homeURL(new Request("http://localhost:9000/account/export"), "account", base), `${base}/functions/v1/account/export`);
  // A caller can't steer the relayed hop: the region parameter is dropped, in any case, and the rest kept.
  assertEquals(homeURL(req("/mcp/connect/request?id=1&forceFunctionRegion=us-east-1"), "mcp", base), `${base}/functions/v1/mcp/connect/request?id=1`);
  assertEquals(homeURL(req("/mcp?ForceFunctionRegion=us-east-1&forcefunctionregion=sa-east-1"), "mcp", base), `${base}/functions/v1/mcp`);
});

Deno.test("the relay passes the caller's headers, asks for the home region, and vouches for the caller's address", () => {
  const h = relayHeaders(req("/mcp", { method: "POST", headers: {
    authorization: "Bearer amb_at_x", apikey: "anon", "content-type": "application/json", "mcp-session-id": "s1", origin: "https://ambernotes.app",
    "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "203.0.113.9, 198.51.100.7", "x-region": "us-east-1", host: "x", "content-length": "12",
    // The runtime asks home only for encodings it decodes itself; the caller's mark is replaced.
    "accept-encoding": "gzip, br, zstd", [RELAY_HEADER]: "1",
    // A caller's own claim, without the secret: dropped.
    "x-mcp-client-ip": "1.2.3.4", "x-mcp-public-url": "https://evil.example",
  } }), away);
  assertEquals(Object.fromEntries(h), {
    authorization: "Bearer amb_at_x", apikey: "anon", "content-type": "application/json", "mcp-session-id": "s1", origin: "https://ambernotes.app",
    "x-mcp-client-ip": "198.51.100.7", "x-mcp-proxy-secret": "proxy-secret", "x-region": "eu-central-1", [RELAY_HEADER]: "us-east-1",
  });
  // What the site's proxy vouched for stays as it said.
  const viaProxy = relayHeaders(req("/mcp", { headers: { "cf-connecting-ip": "76.76.21.21", "x-mcp-client-ip": "198.51.100.8", "x-mcp-public-url": "https://mcp.ambernotes.app", "x-mcp-proxy-secret": "proxy-secret" } }), away);
  assertEquals([viaProxy.get("x-mcp-client-ip"), viaProxy.get("x-mcp-public-url")], ["198.51.100.8", "https://mcp.ambernotes.app"]);
  // And the home region counts that address, not the relay's.
  const arrived = new Request("https://x.test/", { headers: { ...Object.fromEntries(h), "cf-connecting-ip": "52.0.0.1" } });
  assertEquals(clientAddress(arrived, home), "198.51.100.7");
  assertEquals(clientAddress(new Request("https://x.test/", { headers: { "cf-connecting-ip": "52.0.0.1", "x-mcp-client-ip": "198.51.100.7", "x-mcp-proxy-secret": "guess" } }), home), "52.0.0.1");
});

Deno.test("away from home the handler never runs: the home region's answer comes back, body and status", async () => {
  const sent: { url: string; init: RequestInit }[] = [];
  const send = (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return Promise.resolve(new Response('{"ok":true}', { status: 201, headers: { "content-type": "application/json", "content-encoding": "gzip", "www-authenticate": "Bearer x", [REGION_HEADER]: "eu-central-1" } }));
  };
  let ran = 0;
  const serve = atHome("mcp", () => { ran++; return new Response("here"); }, away, send);
  const { value: res, lines } = await quiet(() => serve(req("/mcp/connect/ask?x=1", { method: "POST", headers: { "content-type": "application/json" }, body: '{"id":"1"}' })));
  assertEquals([ran, res.status, await res.text()], [0, 201, '{"ok":true}']);
  assertEquals([res.headers.get(REGION_HEADER), res.headers.get(RELAY_HEADER), res.headers.get("www-authenticate"), res.headers.get("content-encoding")], ["eu-central-1", "us-east-1", "Bearer x", null]);
  assertEquals(sent[0].url, `https://${REF}.supabase.co/functions/v1/mcp/connect/ask?x=1`);
  assertEquals([sent[0].init.method, new TextDecoder().decode(sent[0].init.body as ArrayBuffer)], ["POST", '{"id":"1"}']);
  assertEquals(new Headers(sent[0].init.headers).get("x-region"), "eu-central-1");
  assertEquals(lines.map((l) => [l.event, l.where, l.status]), [["relay", "us-east-1", 201]]);
});

Deno.test("at home the handler runs and the answer says where; a relayed request is not relayed again", async () => {
  const send = () => { throw new Error("must not be called"); };
  const marked = { [RELAY_HEADER]: "us-east-1", "x-mcp-proxy-secret": "proxy-secret" };
  const serve = atHome("mcp", async (r) => new Response(await r.text()), home, send);
  const res = await serve(req("/mcp", { method: "POST", body: "hello", headers: marked }));
  assertEquals([await res.text(), res.headers.get(REGION_HEADER), res.headers.get(RELAY_HEADER)], ["hello", "eu-central-1", null]);
  // The same request landing in a third region with the relay's mark and secret: answered there, not bounced.
  const third = atHome("mcp", () => new Response("x"), env({ ...BASE, SB_REGION: "ap-southeast-1" }), send);
  assertEquals((await third(req("/mcp", { headers: marked }))).headers.get(REGION_HEADER), "ap-southeast-1");
  // A local stack has no region: nothing is added.
  const local = atHome("mcp", () => new Response("x"), env({ ...BASE }), send);
  assertEquals((await local(req("/mcp"))).headers.get(REGION_HEADER), null);
});

Deno.test("a caller who sends the relay's mark without the secret is still sent home", async () => {
  const sent: string[] = [];
  const send = (url: string, init: RequestInit) => {
    sent.push(new Headers(init.headers).get(RELAY_HEADER) ?? "");
    return Promise.resolve(new Response("home", { headers: { [REGION_HEADER]: "eu-central-1" } }));
  };
  let ran = 0;
  const serve = atHome("mcp", () => { ran++; return new Response("here"); }, away, send);
  const { value: res } = await quiet(() => serve(req("/mcp", { method: "POST", body: "{}", headers: { [RELAY_HEADER]: "1" } })));
  assertEquals([ran, await res.text(), sent], [0, "home", ["us-east-1"]]);
});

Deno.test("when home can't be reached, a read is answered here; a write is never run here, the caller is told to try again", async () => {
  const fails = [() => Promise.reject(new TypeError("network")), () => Promise.reject(new DOMException("timed out", "TimeoutError"))];
  for (const send of fails) {
    let ran = 0;
    const serve = atHome("mcp", async (r) => { ran++; return new Response(`here:${r.method}:${await r.text()}`); }, away, send);
    // A write was sent: home may have run it. Not run here; 502, and it is logged.
    for (const method of ["POST", "DELETE", "PUT", "PATCH"]) {
      const { value: res, lines } = await quiet(() => serve(req("/mcp", { method, body: method === "DELETE" ? undefined : '{"jsonrpc":"2.0"}' })));
      assertEquals([res.status, await res.json(), res.headers.get("retry-after")], [502, { error: "Couldn't reach Amber Notes just now. Try again." }, "2"]);
      assertEquals(lines.map((l) => [l.event, l.where, l.method]), [["relay_failed", "us-east-1", method]]);
    }
    assertEquals(ran, 0);
    // A read can't be done twice: answered where it landed, and logged.
    for (const method of ["GET", "HEAD"]) {
      const { value: res, lines } = await quiet(() => serve(req("/share-files?slug=a", { method })));
      assertEquals([res.status, res.headers.get(REGION_HEADER)], [200, "us-east-1"]);
      assertEquals(lines.map((l) => l.event), ["relay_failed"]);
    }
    assertEquals(ran, 2);
  }
});

Deno.test("an answer that didn't come from home is passed back as it is, never run again, and logged as a failure to get home", async () => {
  // The gateway answered instead of the function, or the request ran in another region.
  const answers: [() => Response, number, string][] = [
    [() => new Response("bad gateway", { status: 502 }), 502, "bad gateway"],
    [() => new Response("old home", { status: 200 }), 200, "old home"],
    [() => new Response("ran elsewhere", { status: 201, headers: { [REGION_HEADER]: "us-west-1" } }), 201, "ran elsewhere"],
  ];
  for (const [answer, status, text] of answers) {
    let ran = 0;
    const serve = atHome("mcp", () => { ran++; return new Response("here"); }, away, () => Promise.resolve(answer()));
    const { value: res, lines } = await quiet(() => serve(req("/mcp", { method: "POST", body: "{}" })));
    assertEquals([ran, res.status, await res.text()], [0, status, text]);
    assertEquals(lines.map((l) => [l.event, l.status]), [["relay_failed", status]]);
  }
  // Only a read, and only when no function answered at all, is answered here instead.
  let ran = 0;
  const serve = atHome("share-files", () => { ran++; return new Response("here"); }, away, () => Promise.resolve(new Response("bad gateway", { status: 502 })));
  const { value: res } = await quiet(() => serve(req("/share-files?slug=a")));
  assertEquals([ran, await res.text()], [1, "here"]);
});
