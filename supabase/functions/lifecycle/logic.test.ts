// deno test -A supabase/functions/lifecycle/logic.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { config, decide, type Facts, sameSecret, unsubscribeLinks, unsubscribeToken, validUnsubscribe } from "./logic.ts";

const H = 3_600_000, D = 24 * H;
const NOW = new Date("2026-10-20T08:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const facts = (o: Partial<Facts> & { ageMs: number }): Facts => ({
  user_id: "0b6f6a5e-1d2c-4a8e-9f3b-2c1d0e9f8a7b", email: "sara@example.com",
  signed_up_at: ago(o.ageMs), note_count: 3, imported: false, ai_connected_at: null, connect_tried: false,
  ai_edit_days: 0, history_opened: false, unsubscribed: false, last_sent_at: null, sent: [], ...o,
});
const sentLongAgo = (...kinds: string[]) => ({ sent: kinds, last_sent_at: ago(8 * D) });

Deno.test("no note yet: the stuck email, from a day after sign-up, once, and nothing else", () => {
  assertEquals(decide(facts({ ageMs: 20 * H, note_count: 0 }), NOW), null);
  assertEquals(decide(facts({ ageMs: 25 * H, note_count: 0 }), NOW), "stuck");
  assertEquals(decide(facts({ ageMs: 9 * D, note_count: 0, ...sentLongAgo("stuck") }), NOW), null);
  assertEquals(decide(facts({ ageMs: 11 * D, note_count: 0 }), NOW), null);
});

Deno.test("notes but no AI: one use case per email, from 12 hours, until all are sent", () => {
  assertEquals(decide(facts({ ageMs: 11 * H }), NOW), null);
  assertEquals(decide(facts({ ageMs: 13 * H }), NOW), "ai_groceries");
  assertEquals(decide(facts({ ageMs: 9 * D, ...sentLongAgo("ai_groceries") }), NOW), "ai_meeting");
  assertEquals(decide(facts({ ageMs: 16 * D, ...sentLongAgo("ai_groceries", "ai_meeting") }), NOW), "ai_sort");
  assertEquals(decide(facts({ ageMs: 23 * D, ...sentLongAgo("ai_groceries", "ai_meeting", "ai_sort") }), NOW), null);
});

Deno.test("a big or imported library starts with sorting it", () => {
  assertEquals(decide(facts({ ageMs: 13 * H, note_count: 179 }), NOW), "ai_sort");
  assertEquals(decide(facts({ ageMs: 13 * H, note_count: 5, imported: true }), NOW), "ai_sort");
  assertEquals(decide(facts({ ageMs: 9 * D, note_count: 179, ...sentLongAgo("ai_sort") }), NOW), "ai_groceries");
});

Deno.test("the use cases stop the moment an AI is connected; templates follow a day later", () => {
  assertEquals(decide(facts({ ageMs: 9 * D, ai_connected_at: ago(2 * H), ...sentLongAgo("ai_groceries") }), NOW), null);
  assertEquals(decide(facts({ ageMs: 9 * D, ai_connected_at: ago(2 * D), ...sentLongAgo("ai_groceries") }), NOW), "templates");
});

Deno.test("connected: templates until the AI edits on 3 days, Undo until history is opened", () => {
  assertEquals(decide(facts({ ageMs: 3 * D, ai_connected_at: ago(2 * D), ai_edit_days: 3 }), NOW), "undo");
  assertEquals(decide(facts({ ageMs: 3 * D, ai_connected_at: ago(2 * D), ai_edit_days: 3, history_opened: true }), NOW), null);
  assertEquals(decide(facts({ ageMs: 12 * D, ai_connected_at: ago(9 * D), ...sentLongAgo("templates") }), NOW), "undo");
  assertEquals(decide(facts({ ageMs: 20 * D, ai_connected_at: ago(9 * D), ...sentLongAgo("templates", "undo") }), NOW), null);
});

Deno.test("at most one email in seven days", () => {
  assertEquals(decide(facts({ ageMs: 3 * D, sent: ["ai_groceries"], last_sent_at: ago(2 * D) }), NOW), null);
  assertEquals(decide(facts({ ageMs: 9 * D, sent: ["ai_groceries"], last_sent_at: ago(7 * D) }), NOW), "ai_meeting");
});

Deno.test("never after unsubscribing, never without an address, never after 45 days", () => {
  assertEquals(decide(facts({ ageMs: 2 * D, unsubscribed: true }), NOW), null);
  assertEquals(decide(facts({ ageMs: 2 * D, email: null }), NOW), null);
  assertEquals(decide(facts({ ageMs: 46 * D }), NOW), null);
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
  const links = unsubscribeLinks("https://ambernotes.app", a, t);
  assertEquals(links.page, `https://ambernotes.app/unsubscribe?u=${a}&t=${t}`);
  assertEquals(links.oneClick, `https://ambernotes.app/unsubscribe/confirm?u=${a}&t=${t}`);
});

Deno.test("settings: off unless LIFECYCLE_ENABLED is exactly true; missing secrets turn it off", () => {
  const env = (o: Record<string, string>) => ({ get: (k: string) => o[k] });
  const full = { LIFECYCLE_SINCE: "2026-10-06", RESEND_LIFECYCLE_KEY: "re_x", LIFECYCLE_UNSUBSCRIBE_SECRET: "u".repeat(32), LIFECYCLE_CRON_SECRET: "c".repeat(32) };
  const on = (o: Record<string, string>) => { const c = config(env(o)); return c.ok ? c.config.enabled : c.reason; };
  assertEquals(on(full), false);
  assertEquals(on({ ...full, LIFECYCLE_ENABLED: "1" }), false);
  assertEquals(on({ ...full, LIFECYCLE_ENABLED: "true" }), true);
  assertEquals(on({ ...full, LIFECYCLE_ENABLED: "true", LIFECYCLE_SINCE: "" }), "since_missing");
  assertEquals(on({ ...full, LIFECYCLE_ENABLED: "true", RESEND_LIFECYCLE_KEY: "" }), "key_missing");
  assertEquals(on({ ...full, LIFECYCLE_ENABLED: "true", LIFECYCLE_CRON_SECRET: "short" }), "cron_secret_missing");
  const c = config(env({ ...full, LIFECYCLE_ONLY: " 0B6F6A5E-1d2c-4a8e-9f3b-2c1d0e9f8a7b , " }));
  assert(c.ok && c.config.only?.has("0b6f6a5e-1d2c-4a8e-9f3b-2c1d0e9f8a7b") && c.config.only.size === 1);
});

Deno.test("secrets compare whole", () => {
  assert(sameSecret("abc", "abc"));
  assert(!sameSecret("abc", "abd"));
  assert(!sameSecret("abc", "ab"));
  assert(!sameSecret("", ""));
});
