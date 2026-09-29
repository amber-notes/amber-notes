// Pure pieces of account-status, unit-tested without a database.

/** Trimmed, lower-cased, and plausibly an email address; otherwise null. */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const e = input.trim().toLowerCase();
  if (e.length < 3 || e.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

/** What the app needs to know, and nothing more. */
export type Status = { exists: boolean; password: boolean };

/** Shapes the lookup into the reply. An account without a password (Sign in with Apple only)
 *  exists but can't take a password: the app tells the person to use Apple instead of offering
 *  a password that can't work, or a sign-up that the server would refuse. */
export function statusFrom(row: { exists: boolean; has_password: boolean } | undefined): Status {
  if (!row?.exists) return { exists: false, password: false };
  return { exists: true, password: row.has_password };
}

/** Fixed-window limiter keyed by an opaque string (hashed IP or email). Per isolate. */
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

/** Hex SHA-256 of salt + value: limiter keys never hold a raw address or email. */
export async function hashKey(salt: string, value: string): Promise<string> {
  const bytes = new TextEncoder().encode(salt + "\u0000" + value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Every reply takes at least `floorMs`, so a hit and a miss look the same from outside. */
export async function atLeast<T>(floorMs: number, work: () => Promise<T>, now = () => performance.now()): Promise<T> {
  const start = now();
  try {
    return await work();
  } finally {
    const left = floorMs - (now() - start);
    if (left > 0) await new Promise((r) => setTimeout(r, left));
  }
}
