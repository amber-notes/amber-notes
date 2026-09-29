// Pure pieces of share-files, unit-tested without a server.

/** Attachment ids a note body links to, as `[name](pane-file:<id>)` or `![name](pane-file:<id>)`. */
export function referencedFiles(body: string): string[] {
  const ids = new Set<string>();
  for (const m of body.matchAll(/\]\(pane-file:([0-9a-fA-F-]{36})\)/g)) ids.add(m[1].toLowerCase());
  return [...ids].slice(0, 200);
}

/** A fixed-window counter per key; good enough to stop one client hammering the function. */
export class RateLimiter {
  private hits = new Map<string, { count: number; reset: number }>();
  constructor(private limit: number, private windowMs: number) {}
  allow(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h || now >= h.reset) {
      if (this.hits.size > 10_000) this.hits.clear();
      this.hits.set(key, { count: 1, reset: now + this.windowMs });
      return true;
    }
    h.count += 1;
    return h.count <= this.limit;
  }
}
