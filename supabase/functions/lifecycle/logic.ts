// The lifecycle emails' decisions, without a database or a network: who gets which email and when,
// the unsubscribe links, and the settings. docs/Technical/lifecycle-emails.md explains the whole.

export type Kind = "welcome" | "stuck" | "import" | "connect" | "try" | "undo" | "apps" | "templates" | "iphone" | "mac" | "share";

/// What lifecycle_facts() says about one account. Activity only, never what a note says.
export type Facts = {
  user_id: string;
  email: string | null;
  signed_up_at: Date;
  /// Notes in the account (a count of rows; no text is read).
  note_count: number;
  /// The account used Bring your notes (pane_setup.imported_at).
  imported: boolean;
  /// The share of notes, in percent, that sit in the account's biggest folder (or in no folder):
  /// from folder ids only, never folder names (they're encrypted).
  biggest_folder_share: number;
  /// The device's offset from UTC in minutes, when the app has reported it (null until it does).
  utc_offset_minutes: number | null;
  /// Devices the app has been opened on (pane_devices).
  on_mac: boolean;
  on_iphone: boolean;
  /// When the first AI was connected (mcp_tokens, OAuth grants included), or null.
  ai_connected_at: Date | null;
  /// An AI connection was asked for from a browser and is still waiting (connect_asks).
  connect_tried: boolean;
  /// Days on which an AI changed a note (pane_activity).
  ai_edit_days: number;
  /// pane_feature_use: version history opened, a template added, an app note made, a note shared.
  history_opened: boolean;
  used_template: boolean;
  has_app: boolean;
  shared: boolean;
  unsubscribed: boolean;
  last_sent_at: Date | null;
  /// Every email row the account has, sent or failed (the welcome included).
  sent: string[];
  /// Ladder emails sent since the account's last sign of life (the app opened or synced, an AI
  /// connected, used or editing, a click on one of these emails, or a reply). The welcome isn't one.
  sent_since_active: number;
};

/// Emails for features that haven't shipped wait behind these (env APPS_LIVE, APP_STORE_LIVE,
/// SHARING_LIVE, each "true" to turn on).
export type Flags = { apps: boolean; appStore: boolean; sharing: boolean };
export const NO_FLAGS: Flags = { apps: false, appStore: false, sharing: false };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/// Spacing: at least 3 days apart in the first 10 days after sign-up, then at least 7.
export function gapAfter(age: number): number {
  return age <= 10 * DAY ? 3 * DAY : 7 * DAY;
}
/// Silence: after one email with no sign of life since, the next waits the long gap; after two in a
/// row, nothing until the person comes back. Then the normal gaps apply again.
export const SILENT_STOP = 2;

/// How long to wait after the last email: the normal gap, or the long one when the last went unanswered.
export function gapFor(f: Pick<Facts, "signed_up_at" | "sent_since_active">, now: Date): number {
  return f.sent_since_active >= 1 ? 7 * DAY : gapAfter(now.getTime() - f.signed_up_at.getTime());
}

/// Nothing automatic after the first 30 days, and at most 6 ladder emails in them (the welcome
/// isn't counted).
export const LAST_DAY_MS = 30 * DAY;
export const MAX_EMAILS = 6;

/// The ladder's emails, as counted against MAX_EMAILS.
export const ladderSent = (f: Pick<Facts, "sent">) => f.sent.filter((k) => k !== "welcome").length;

// ---- The welcome ----------------------------------------------------------------------------------

/// The welcome goes a couple of minutes after sign-up, once: long enough for the app to report its
/// device and for an AI connection made during sign-up to land, so its one step fits. An account
/// that didn't get it within the hour (the function was off or down) never does; the ladder carries on.
export const WELCOME_AFTER_MS = 2 * 60_000;
export const WELCOME_WITHIN_MS = HOUR;

export function welcomeDue(f: Pick<Facts, "email" | "unsubscribed" | "sent" | "signed_up_at">, now: Date): boolean {
  const age = now.getTime() - f.signed_up_at.getTime();
  return !!f.email && !f.unsubscribed && !f.sent.includes("welcome") && age >= WELCOME_AFTER_MS && age <= WELCOME_WITHIN_MS;
}

/// The welcome's one next step, from where the person is: no AI yet, connect one; an AI but no app
/// (signed up through ChatGPT or Claude), get the app; both, try a first ask.
export type WelcomeStep = "connect" | "app" | "try";
export function welcomeStep(f: Pick<Facts, "ai_connected_at" | "on_mac" | "on_iphone">): WelcomeStep {
  if (f.ai_connected_at === null) return "connect";
  return f.on_mac || f.on_iphone ? "try" : "app";
}

type Rung = {
  kind: Kind;
  /// Whether this rung is for the account at all (its flag is on, it has the device, and so on).
  for: (f: Facts, flags: Flags) => boolean;
  /// Done: the email is never sent.
  done: (f: Facts) => boolean;
  /// Not before this moment.
  ready: (f: Facts, now: Date) => boolean;
};

const after = (f: Facts, now: Date, ms: number) => now.getTime() - f.signed_up_at.getTime() >= ms;

/// The next-step ladder. Each round an account gets the first rung it hasn't done and hasn't been
/// sent. The app's own setup card (Pane/Views/SetupCard.swift: Bring your notes, Connect your AI,
/// Try it) is rungs 1 to 4.
export const LADDER: Rung[] = [
  // 1. Signed in, no note a day later.
  { kind: "stuck", for: () => true, done: (f) => f.note_count > 0, ready: (f, n) => after(f, n, DAY) },
  // 2. A few notes on a Mac that never imported: Bring your Apple Notes over.
  { kind: "import", for: (f) => f.on_mac, done: (f) => f.imported || f.note_count >= 5, ready: (f, n) => after(f, n, 12 * HOUR) },
  // 3. No AI connected: one concrete use case and the way to connect.
  { kind: "connect", for: () => true, done: (f) => f.ai_connected_at !== null, ready: (f, n) => after(f, n, 12 * HOUR) },
  // 4. Connected a day ago, no AI edit yet: three prompts to paste.
  { kind: "try", for: (f) => f.ai_connected_at !== null, done: (f) => f.ai_edit_days > 0,
    ready: (f, n) => f.ai_connected_at !== null && n.getTime() - f.ai_connected_at.getTime() >= DAY },
  // 4b. After the first AI edit: Undo and version history.
  { kind: "undo", for: (f) => f.ai_edit_days > 0, done: (f) => f.history_opened, ready: () => true },
  // 5. Apps in notes (when they ship).
  { kind: "apps", for: (_f, flags) => flags.apps, done: (f) => f.has_app, ready: () => true },
  // 6. Templates, until one is used.
  { kind: "templates", for: () => true, done: (f) => f.used_template, ready: (f, n) => after(f, n, 3 * DAY) },
  // 7. Only on the Mac (when the iPhone app is in the App Store).
  { kind: "iphone", for: (f, flags) => flags.appStore && f.on_mac && !f.on_iphone, done: (f) => f.on_iphone, ready: () => true },
  // 7b. Only on the iPhone: the Mac app (a free download today, so no flag).
  { kind: "mac", for: (f) => f.on_iphone && !f.on_mac, done: (f) => f.on_mac, ready: () => true },
  // 8. Three weeks on their own (when sharing with people ships).
  { kind: "share", for: (_f, flags) => flags.sharing, done: (f) => f.shared, ready: (f, n) => after(f, n, 21 * DAY) },
];

/// The connect email shows sorting into folders when the library is big and mostly in one place;
/// otherwise a grocery list. Never says a number.
export function sortable(f: Pick<Facts, "note_count" | "biggest_folder_share">): boolean {
  return f.note_count >= 20 && f.biggest_folder_share >= 70;
}

/// Emails go out at 9 in the morning where the person is. The app doesn't report a time zone yet;
/// until it does, Central European time (UTC+1) is assumed, which is 08:00 UTC.
export const SEND_HOUR = 9;
export const DEFAULT_OFFSET_MINUTES = 60;
export function localMorning(now: Date, offsetMinutes: number | null): boolean {
  const local = new Date(now.getTime() + (offsetMinutes ?? DEFAULT_OFFSET_MINUTES) * 60_000);
  return local.getUTCHours() === SEND_HOUR;
}

/// Which subject line an account gets when subject lines are being compared: half and half, fixed
/// per account, decided from its id.
export function variantOf(userId: string): 0 | 1 {
  let h = 0;
  for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 2) as 0 | 1;
}

/// The email this account should get now, or null.
export function decide(f: Facts, now: Date, flags: Flags = NO_FLAGS): Kind | null {
  if (f.unsubscribed || !f.email) return null;
  const age = now.getTime() - f.signed_up_at.getTime();
  if (age > LAST_DAY_MS || ladderSent(f) >= MAX_EMAILS) return null;
  if (f.sent_since_active >= SILENT_STOP) return null;
  if (f.last_sent_at && now.getTime() - f.last_sent_at.getTime() < gapFor(f, now)) return null;
  for (const rung of LADDER) {
    if (f.sent.includes(rung.kind) || !rung.for(f, flags) || rung.done(f)) continue;
    // The first rung that's due but not ready yet waits: nothing further up the ladder jumps it.
    return rung.ready(f, now) ? rung.kind : null;
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

// ---- Click links ---------------------------------------------------------------------------------

/// Where a tracked link may lead. Anything else isn't wrapped, and the redirect refuses it.
export const CLICK_HOSTS = ["ambernotes.app", "chatgpt.com", "claude.ai", "apps.apple.com"];

export function clickable(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && CLICK_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

/// The link's name in email_clicks: host and path only, never the query.
export function linkName(url: string): string {
  const u = new URL(url);
  return `${u.hostname}${u.pathname}`.slice(0, 100);
}

async function clickSig(secret: string, sendId: number, url: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`click:${sendId}:${url}`)));
  return b64url(mac).slice(0, 22);
}

/// A link through ambernotes.app/go that counts the click (which email, which link) and goes on.
export async function trackedLink(site: string, secret: string, sendId: number, url: string): Promise<string> {
  const q = new URLSearchParams({ s: String(sendId), to: url, t: await clickSig(secret, sendId, url) });
  return `${site}/go?${q}`;
}

export async function validClick(secret: string, sendId: unknown, url: unknown, token: unknown): Promise<boolean> {
  if (typeof sendId !== "string" || !/^\d{1,15}$/.test(sendId) || typeof url !== "string" || typeof token !== "string") return false;
  if (!clickable(url)) return false;
  const want = await clickSig(secret, Number(sendId), url);
  if (want.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

// ---- Settings -------------------------------------------------------------------------------------

export type Env = { get(name: string): string | undefined };

export type Config = {
  /// Nothing is sent unless LIFECYCLE_ENABLED is exactly "true".
  enabled: boolean;
  flags: Flags;
  /// Measurement, each off unless its variable is "true": compare two subject lines per email
  /// (LIFECYCLE_SUBJECT_TEST), count link clicks through ambernotes.app/go (LIFECYCLE_TRACK_CLICKS).
  subjectTest: boolean;
  trackClicks: boolean;
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
  /// Staging (docs/Technical/staging.md): the site its links open (LIFECYCLE_SITE, https only), a
  /// prefix on every subject (LIFECYCLE_SUBJECT_PREFIX, "[Staging] "), and manual rounds that may send
  /// outside the 9 o'clock hour (LIFECYCLE_MANUAL_ROUNDS, for scripts/staging.sh lifecycle-next).
  subjectPrefix: string;
  manualRounds: boolean;
};

export const FROM = "Emil at Amber Notes <emil@ambernotes.app>";
export const REPLY_TO = "emil@ambernotes.app";
export const SITE = "https://ambernotes.app";

/// The settings, or why there are none. Missing secrets turn sending off rather than failing later.
export function config(env: Env): { ok: true; config: Config } | { ok: false; reason: string } {
  const on = (name: string) => (env.get(name) ?? "").trim() === "true";
  const enabled = on("LIFECYCLE_ENABLED");
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
      flags: { apps: on("APPS_LIVE"), appStore: on("APP_STORE_LIVE"), sharing: on("SHARING_LIVE") },
      subjectTest: on("LIFECYCLE_SUBJECT_TEST"),
      trackClicks: on("LIFECYCLE_TRACK_CLICKS"),
      only: onlyRaw.length ? new Set(onlyRaw) : null,
      from: env.get("LIFECYCLE_FROM")?.trim() || FROM,
      replyTo: REPLY_TO,
      site: (env.get("LIFECYCLE_SITE") ?? "").trim().startsWith("https://") ? env.get("LIFECYCLE_SITE")!.trim().replace(/\/+$/, "") : SITE,
      subjectPrefix: env.get("LIFECYCLE_SUBJECT_PREFIX") ?? "",
      manualRounds: on("LIFECYCLE_MANUAL_ROUNDS"),
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
