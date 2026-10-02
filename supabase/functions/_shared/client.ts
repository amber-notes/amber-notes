/// The caller's address, for rate limits. Cloudflare sits in front of the functions: it sets
/// cf-connecting-ip itself and refuses a request that brings its own, and it appends the real
/// address to whatever x-forwarded-for the caller sent. So the first x-forwarded-for entry is the
/// caller's to choose, and a limit keyed on it can be dodged by sending a new one each time.
/// Without Cloudflare (a local stack) the last entry is the one the nearest proxy added.
///
/// One exception: a request relayed from another region (_shared/region.ts) or sent by the site's
/// proxy comes from their address, not the caller's, so they state the caller's in
/// x-mcp-client-ip, and it counts only with the shared secret (MCP_PROXY_SECRET).
export function clientAddress(req: Request, env: { get(name: string): string | undefined } = Deno.env): string {
  const secret = env.get("MCP_PROXY_SECRET");
  const stated = req.headers.get("x-mcp-client-ip")?.trim();
  if (secret && stated && same(req.headers.get("x-mcp-proxy-secret") ?? "", secret)) return stated;
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  return req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown";
}

function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
