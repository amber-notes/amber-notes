// The lifecycle emails' decisions, without a database or a network: who gets which email and when,
// the unsubscribe links, and the settings. docs/Technical/lifecycle-emails.md explains the whole.

export type Kind = "stuck" | "connect" | "templates" | "undo";

/// What lifecycle_facts() says about one account. Activity only, never what a note says.
export type Facts = {
  user_id: string;
  email: string | null;
  signed_up_at: Date;
  has_note: boolean;
  ai_connected: boolean;
  ai_edited: boolean;
  history_opened: boolean;
  unsubscribed: boolean;
  last_sent_at: Date | null;
  sent: string[];
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/// At most one email in any seven days, whatever the schedule says.
export const GAP_MS = 7 * DAY;

type Step = {
  kind: Kind;
  /// How long after sign-up the email may go, at the earliest and at the latest.
  after: number;
  until: number;
  /// Who the email is for.
  for: (f: Facts) => boolean;
  /// What the email asks for. Once it has happened, the email is never sent.
  goal: (f: Facts) => boolean;
};

/// In order of priority: when two are due on the same day, the first one goes.
export const SEQUENCE: Step[] = [
  // No note a day after signing in: something may have gone wrong.
  { kind: "stuck", after: DAY, until: 10 * DAY, for: () => true, goal: (f) => f.has_note },
  // The step Amber Notes is for. The cron runs once a day, so this lands 12 to 36 hours in.
  { kind: "connect", after: 12 * HOUR, until: 10 * DAY, for: (f) => f.has_note, goal: (f) => f.ai_connected },
  // Something to do with a connected AI. Done once an AI has edited a note.
  { kind: "templates", after: 3 * DAY, until: 21 * DAY, for: (f) => f.has_note, goal: (f) => f.ai_edited },
  // Undo and version history. Done once version history has been opened.
  { kind: "undo", after: 7 * DAY, until: 28 * DAY, for: (f) => f.has_note, goal: (f) => f.history_opened },
];

/// The email this account should get now, or null.
export function decide(f: Facts, now: Date): Kind | null {
  if (f.unsubscribed || !f.email) return null;
  if (f.last_sent_at && now.getTime() - f.last_sent_at.getTime() < GAP_MS) return null;
  const age = now.getTime() - f.signed_up_at.getTime();
  for (const step of SEQUENCE) {
    if (f.sent.includes(step.kind)) continue;
    if (age < step.after || age > step.until) continue;
    if (!step.for(f) || step.goal(f)) continue;
    return step.kind;
  }
  return null;
}

// ---- Unsubscribe links ----------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`unsubscribe:${message}`)));
}

/// The token in an account's unsubscribe link: an HMAC of its id, so a link works without signing
/// in and can't be made for another account.
export async function unsubscribeToken(secret: string, userId: string): Promise<string> {
  return b64url(await hmac(secret, userId));
}

export async function validUnsubscribe(secret: string, userId: unknown, token: unknown): Promise<boolean> {
  if (typeof userId !== "string" || typeof token !== "string" || !UUID.test(userId) || token.length > 100) return false;
  const want = await unsubscribeToken(secret, userId);
  if (want.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

/// The page the email's link opens (one button), and the address mail apps post to (RFC 8058).
export function unsubscribeLinks(site: string, userId: string, token: string) {
  const q = `u=${userId}&t=${token}`;
  return { page: `${site}/unsubscribe?${q}`, oneClick: `${site}/unsubscribe/confirm?${q}` };
}

// ---- Settings -------------------------------------------------------------------------------------

export type Env = { get(name: string): string | undefined };

export type Config = {
  /// Nothing is sent unless LIFECYCLE_ENABLED is exactly "true".
  enabled: boolean;
  /// Accounts made before this never get these emails (LIFECYCLE_SINCE, an ISO date).
  since: Date;
  /// When set (LIFECYCLE_ONLY, comma-separated account ids), only these accounts get email: for a
  /// first try on a test account.
  only: Set<string> | null;
  resendKey: string;
  unsubscribeSecret: string;
  cronSecret: string;
  from: string;
  replyTo: string;
  site: string;
};

export const FROM = "Emil at Amber Notes <hello@ambernotes.app>";
export const REPLY_TO = "hello@ambernotes.app";
export const SITE = "https://ambernotes.app";

/// The settings, or why there are none. Missing secrets turn sending off rather than failing later.
export function config(env: Env): { ok: true; config: Config } | { ok: false; reason: string } {
  const enabled = (env.get("LIFECYCLE_ENABLED") ?? "").trim() === "true";
  const sinceRaw = (env.get("LIFECYCLE_SINCE") ?? "").trim();
  const since = new Date(sinceRaw);
  const resendKey = (env.get("RESEND_LIFECYCLE_KEY") ?? "").trim();
  const unsubscribeSecret = (env.get("LIFECYCLE_UNSUBSCRIBE_SECRET") ?? "").trim();
  const cronSecret = (env.get("LIFECYCLE_CRON_SECRET") ?? "").trim();
  if (!sinceRaw || Number.isNaN(since.getTime())) return { ok: false, reason: "since_missing" };
  if (!resendKey) return { ok: false, reason: "key_missing" };
  if (unsubscribeSecret.length < 32) return { ok: false, reason: "unsubscribe_secret_missing" };
  if (cronSecret.length < 32) return { ok: false, reason: "cron_secret_missing" };
  const onlyRaw = (env.get("LIFECYCLE_ONLY") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return {
    ok: true,
    config: {
      enabled, since, resendKey, unsubscribeSecret, cronSecret,
      only: onlyRaw.length ? new Set(onlyRaw) : null,
      from: env.get("LIFECYCLE_FROM")?.trim() || FROM,
      replyTo: REPLY_TO,
      site: SITE,
    },
  };
}

/// Compares two secrets in constant time.
export function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
