/// The caller's address, for rate limits. Cloudflare sits in front of the functions: it sets
/// cf-connecting-ip itself and refuses a request that brings its own, and it appends the real
/// address to whatever x-forwarded-for the caller sent. So the first x-forwarded-for entry is the
/// caller's to choose, and a limit keyed on it can be dodged by sending a new one each time.
/// Without Cloudflare (a local stack) the last entry is the one the nearest proxy added.
export function clientAddress(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  return req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown";
}
