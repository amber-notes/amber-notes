// deno test -A supabase/functions/lifecycle/logic.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { clickable, config, decide, type Facts, gapAfter, LADDER, ladderSent, linkName, localMorning, sameSecret, sortable, trackedLink, unsubscribeLinks, unsubscribeToken, validClick, validUnsubscribe, variantOf, welcomeDue, welcomeStep } from "./logic.ts";

const H = 3_600_000, D = 24 * H;
const NOW = new Date("2026-10-20T08:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const ON = { apps: true, appStore: true, sharing: true };
/// A Mac account two days in with a few notes and nothing else done.
const facts = (o: Partial<Facts> & { ageMs?: number } = {}): Facts => ({
  user_id: "0b6f6a5e-1d2c-4a8e-9f3b-2c1d0e9f8a7b", email: "sara@example.com",
  signed_up_at: ago(o.ageMs ?? 2 * D), note_count: 3, imported: false, biggest_folder_share: 100, utc_offset_minutes: null, on_mac: true, on_iphone: false,
  ai_connected_at: null, connect_tried: false, ai_edit_days: 0, history_opened: false, used_template: false,
  has_app: false, shared: false, unsubscribed: false, last_sent_at: null, sent: [], sent_since_active: 0, ...o,
});
/// Already sent, long enough ago that spacing doesn't block.
const sent = (...kinds: string[]) => ({ sent: kinds, last_sent_at: ago(8 * D) });

Deno.test("the ladder's order", () => {
  assertEquals(LADDER.map((r) => r.kind), ["stuck", "import", "connect", "try", "undo", "apps", "templates", "iphone", "mac", "share"]);
});

Deno.test("rung 1: no note a day after sign-up gets the stuck email first", () => {
  assertEquals(decide(facts({ ageMs: 20 * H, note_count: 0 }), NOW), null);
  assertEquals(decide(facts({ ageMs: 25 * H, note_count: 0 }), NOW), "stuck");
});

Deno.test("rung 2: a few notes on a Mac, never imported: Bring your Apple Notes over", () => {
  assertEquals(decide(facts(), NOW), "import");
  assertEquals(decide(facts({ imported: true }), NOW), "connect");
  assertEquals(decide(facts({ note_count: 5 }), NOW), "connect");
  assertEquals(decide(facts({ on_mac: false, on_iphone: true }), NOW), "connect");
});

Deno.test("rung 3 to 4: connect until an AI is connected; Try this first a day after, until the first AI edit", () => {
  assertEquals(decide(facts(sent("import")), NOW), "connect");
  assertEquals(decide(facts({ ...sent("import"), ai_connected_at: ago(2 * H) }), NOW), null);
  assertEquals(decide(facts({ ...sent("import"), ai_connected_at: ago(2 * D) }), NOW), "try");
  assertEquals(decide(facts({ ...sent("import"), ai_connected_at: ago(2 * D), ai_edit_days: 1 }), NOW), "undo");
});

Deno.test("after the first AI edit: Undo until history is opened, then templates (from day 3)", () => {
  const done = { ai_connected_at: ago(3 * D), ai_edit_days: 2, imported: true };
  assertEquals(decide(facts({ ...done, ageMs: 4 * D }), NOW), "undo");
  assertEquals(decide(facts({ ...done, ageMs: 4 * D, history_opened: true }), NOW), "templates");
  assertEquals(decide(facts({ ...done, ageMs: 2 * D, history_opened: true }), NOW), null);
  assertEquals(decide(facts({ ...done, ageMs: 4 * D, history_opened: true, used_template: true }), NOW), null);
});

Deno.test("flags: apps, iPhone and sharing only when their feature is live", () => {
  const all = { imported: true, ai_connected_at: ago(3 * D), ai_edit_days: 2, history_opened: true, used_template: true, ageMs: 22 * D };
  assertEquals(decide(facts(all), NOW), null);
  assertEquals(decide(facts(all), NOW, ON), "apps");
  assertEquals(decide(facts({ ...all, has_app: true }), NOW, ON), "iphone");
  assertEquals(decide(facts({ ...all, has_app: true, on_iphone: true }), NOW, ON), "share");
  assertEquals(decide(facts({ ...all, has_app: true, on_iphone: true, shared: true }), NOW, ON), null);
  assertEquals(decide(facts({ ...all, has_app: true, ageMs: 22 * D, on_mac: false, on_iphone: true }), NOW, ON), "mac");
});

Deno.test("iPhone only: the Mac email, until a Mac install", () => {
  const all = { imported: true, ai_connected_at: ago(3 * D), ai_edit_days: 2, history_opened: true, used_template: true, ageMs: 5 * D, on_mac: false, on_iphone: true };
  assertEquals(decide(facts(all), NOW), "mac");
  assertEquals(decide(facts({ ...all, on_mac: true }), NOW), null);
});

Deno.test("the connect email sorts into folders only for a big library mostly in one place", () => {
  assertEquals(sortable({ note_count: 179, biggest_folder_share: 85 }), true);
  assertEquals(sortable({ note_count: 179, biggest_folder_share: 40 }), false);
  assertEquals(sortable({ note_count: 12, biggest_folder_share: 100 }), false);
});

Deno.test("send time: 9 in the person's morning, 08:00 UTC when the time zone isn't known", () => {
  assertEquals(localMorning(new Date("2026-10-20T08:00:00Z"), null), true);
  assertEquals(localMorning(new Date("2026-10-20T09:00:00Z"), null), false);
  assertEquals(localMorning(new Date("2026-10-20T13:00:00Z"), -240), true);
  assertEquals(localMorning(new Date("2026-10-20T03:30:00Z"), 330), true);
});

Deno.test("subject line variants: half and half, fixed per account", () => {
  const ids = Array.from({ length: 400 }, () => crypto.randomUUID());
  const ones = ids.filter((id) => variantOf(id) === 1).length;
  assert(ones > 150 && ones < 250, String(ones));
  assertEquals(variantOf(ids[0]), variantOf(ids[0]));
});

Deno.test("click links: signed per email and link, only to the emails' own hosts, and named without the query", async () => {
  const s = "x".repeat(40);
  const link = await trackedLink("https://pintonotes.com", s, 42, "https://chatgpt.com/?q=hi");
  const q = new URL(link).searchParams;
  assertEquals(new URL(link).pathname, "/go");
  assert(await validClick(s, q.get("s"), q.get("to"), q.get("t")));
  assert(!await validClick(s, "43", q.get("to"), q.get("t")));
  assert(!await validClick(s, q.get("s"), "https://chatgpt.com/?q=other", q.get("t")));
  assert(!await validClick(s, q.get("s"), "https://evil.example/", q.get("t")));
  assertEquals([clickable("https://claude.ai/new"), clickable("https://pintonotes.com/download"), clickable("https://ambernotes.app/open/import"), clickable("http://pintonotes.com/"), clickable("https://evil.example/")], [true, true, true, false, false]);
  assertEquals(linkName("https://chatgpt.com/?q=private"), "chatgpt.com/");
});

Deno.test("never twice: a rung already sent is skipped for the next one", () => {
  assertEquals(decide(facts({ ...sent("import", "connect"), ageMs: 4 * D }), NOW), "templates");
  assertEquals(decide(facts({ ageMs: 9 * D, note_count: 0, ...sent("stuck") }), NOW), "import");
});

Deno.test("spacing: 3 days apart in the first 10 days, then 7", () => {
  assertEquals(gapAfter(10 * D), 3 * D);
  assertEquals(gapAfter(11 * D), 7 * D);
  assertEquals(decide(facts({ ageMs: 5 * D, sent: ["import"], last_sent_at: ago(2 * D) }), NOW), null);
  assertEquals(decide(facts({ ageMs: 5 * D, sent: ["import"], last_sent_at: ago(3 * D) }), NOW), "connect");
  assertEquals(decide(facts({ ageMs: 14 * D, sent: ["import"], last_sent_at: ago(5 * D) }), NOW), null);
  assertEquals(decide(facts({ ageMs: 14 * D, sent: ["import"], last_sent_at: ago(7 * D) }), NOW), "connect");
});

Deno.test("at most 6 emails, and nothing after the first 30 days", () => {
  const six = { sent: ["stuck", "import", "connect", "try", "undo", "templates"], last_sent_at: ago(8 * D), ageMs: 25 * D };
  assertEquals(decide(facts({ ...six, has_app: false }), NOW, ON), null);
  assertEquals(decide(facts({ ageMs: 31 * D }), NOW), null);
});

Deno.test("silence: one unanswered email means the long gap; two in a row and nothing until they come back", () => {
  const quiet = (n: number, lastAgo: number) => facts({ ageMs: 9 * D, sent: ["import", "connect"].slice(0, n), last_sent_at: ago(lastAgo), sent_since_active: n });
  // Inside the first 10 days the gap is 3 days, but not after an email that went unanswered.
  assertEquals(decide(facts({ ageMs: 9 * D, sent: ["import"], last_sent_at: ago(4 * D), sent_since_active: 0 }), NOW), "connect");
  assertEquals(decide(quiet(1, 4 * D), NOW), null);
  assertEquals(decide(quiet(1, 7 * D), NOW), "connect");
  assertEquals(decide(quiet(2, 30 * D), NOW), null);
  // They come back (any activity after the last email): the ladder goes on with the normal gaps.
  assertEquals(decide(facts({ ageMs: 9 * D, sent: ["import", "connect"], last_sent_at: ago(3 * D), sent_since_active: 0, imported: true }), NOW), "templates");
});

Deno.test("never after unsubscribing, never without an address", () => {
  assertEquals(decide(facts({ unsubscribed: true }), NOW), null);
  assertEquals(decide(facts({ email: null }), NOW), null);
});

Deno.test("unsubscribe tokens work for their own account only", async () => {
  const s = "x".repeat(40), a = "0b6f6a5e-1d2c-4a8e-9f3b-2c1d0e9f8a7b", b = "1c7f6a5e-1d2c-4a8e-9f3b-2c1d0e9f8a7b";
  const t = await unsubscribeToken(s, a);
  assert(/^[A-Za-z0-9_-]{43}$/.test(t));
  assert(await validUnsubscribe(s, a, t));
  assert(!await validUnsubscribe(s, b, t));
  assert(!await validUnsubscribe("y".repeat(40), a, t));
  assert(!await validUnsubscribe(s, a, t.slice(1)));
  assert(!await validUnsubscribe(s, "nope", t));
  const links = unsubscribeLinks("https://pintonotes.com", a, t);
  assertEquals(links.page, `https://pintonotes.com/unsubscribe?u=${a}&t=${t}`);
  assertEquals(links.oneClick, `https://pintonotes.com/unsubscribe/confirm?u=${a}&t=${t}`);
});

Deno.test("settings: off unless LIFECYCLE_ENABLED is exactly true; missing secrets turn it off", () => {
  const env = (o: Record<string, string>) => ({ get: (k: string) => o[k] });
  const full = { LIFECYCLE_SINCE: "2026-10-06", RESEND_LIFECYCLE_KEY: "re_x", LIFECYCLE_UNSUBSCRIBE_SECRET: "u".repeat(32), LIFECYCLE_CRON_SECRET: "c".repeat(32) };
  const on = (o: Record<string, string>) => { const c = config(env(o)); return c.ok ? c.config.enabled : c.reason; };
  assertEquals(on(full), false);
  const flags = (o: Record<string, string>) => { const c = config(env(o)); return c.ok ? c.config.flags : null; };
  assertEquals(flags(full), { apps: false, appStore: false, sharing: false });
  assertEquals(flags({ ...full, APPS_LIVE: "true", APP_STORE_LIVE: "yes" }), { apps: true, appStore: false, sharing: false });
  assertEquals(on({ ...full, LIFECYCLE_ENABLED: "1" }), false);
  assertEquals(on({ ...full, LIFECYCLE_ENABLED: "true" }), true);
  assertEquals(on({ ...full, LIFECYCLE_ENABLED: "true", LIFECYCLE_SINCE: "" }), "since_missing");
  assertEquals(on({ ...full, LIFECYCLE_ENABLED: "true", RESEND_LIFECYCLE_KEY: "" }), "key_missing");
  assertEquals(on({ ...full, LIFECYCLE_ENABLED: "true", LIFECYCLE_CRON_SECRET: "short" }), "cron_secret_missing");
  const c = config(env({ ...full, LIFECYCLE_ONLY: " 0B6F6A5E-1d2c-4a8e-9f3b-2c1d0e9f8a7b , " }));
  assert(c.ok && c.config.only?.has("0b6f6a5e-1d2c-4a8e-9f3b-2c1d0e9f8a7b") && c.config.only.size === 1);
});

Deno.test("settings: production by default; staging sets its site, a subject prefix and manual rounds", () => {
  const env = (o: Record<string, string>) => ({ get: (k: string) => o[k] });
  const full = { LIFECYCLE_SINCE: "2026-10-06", RESEND_LIFECYCLE_KEY: "re_x", LIFECYCLE_UNSUBSCRIBE_SECRET: "u".repeat(32), LIFECYCLE_CRON_SECRET: "c".repeat(32) };
  const cfg = (o: Record<string, string>) => { const c = config(env({ ...full, ...o })); if (!c.ok) throw new Error(c.reason); return c.config; };
  assertEquals([cfg({}).site, cfg({}).open, cfg({}).subjectPrefix, cfg({}).manualRounds], ["https://pintonotes.com", "https://ambernotes.app", "", false]);
  const s = cfg({ LIFECYCLE_SITE: "https://amber-notes-staging.vercel.app/", LIFECYCLE_SUBJECT_PREFIX: "[Staging] ", LIFECYCLE_MANUAL_ROUNDS: "true" });
  assertEquals([s.site, s.open, s.subjectPrefix, s.manualRounds], ["https://amber-notes-staging.vercel.app", "https://amber-notes-staging.vercel.app", "[Staging] ", true]);
  assertEquals(cfg({ LIFECYCLE_SITE: "javascript:alert(1)" }).site, "https://pintonotes.com");
});

Deno.test("secrets compare whole", () => {
  assert(sameSecret("abc", "abc"));
  assert(!sameSecret("abc", "abd"));
  assert(!sameSecret("abc", "ab"));
  assert(!sameSecret("", ""));
});

Deno.test("welcome: 2 to 60 minutes after sign-up, once, never after unsubscribing or without an address", () => {
  const M = 60_000;
  assertEquals(welcomeDue(facts({ ageMs: 1 * M }), NOW), false);
  assertEquals(welcomeDue(facts({ ageMs: 3 * M }), NOW), true);
  assertEquals(welcomeDue(facts({ ageMs: 61 * M }), NOW), false);
  assertEquals(welcomeDue(facts({ ageMs: 3 * M, sent: ["welcome"] }), NOW), false);
  assertEquals(welcomeDue(facts({ ageMs: 3 * M, unsubscribed: true }), NOW), false);
  assertEquals(welcomeDue(facts({ ageMs: 3 * M, email: null }), NOW), false);
});

Deno.test("welcome: its one step fits where the person is", () => {
  assertEquals(welcomeStep(facts()), "connect");
  assertEquals(welcomeStep(facts({ on_mac: false, ai_connected_at: ago(H) })), "app");
  assertEquals(welcomeStep(facts({ on_mac: false, on_iphone: true, ai_connected_at: ago(H) })), "try");
});

Deno.test("welcome: outside the ladder's cap, and the ladder's first email waits its usual gap after it", () => {
  // Six ladder emails plus the welcome: the cap counts the six.
  assertEquals(ladderSent(facts({ sent: ["welcome", "stuck", "import"] })), 2);
  // A welcome two days ago (an hour after sign-up), unanswered: no ladder email until day 3.
  const welcomed = { sent: ["welcome"], sent_since_active: 0, note_count: 0 };
  assertEquals(decide(facts({ ...welcomed, ageMs: 2 * D, last_sent_at: ago(2 * D - H) }), NOW), null);
  assertEquals(decide(facts({ ...welcomed, ageMs: 3 * D + H, last_sent_at: ago(3 * D) }), NOW), "stuck");
});
