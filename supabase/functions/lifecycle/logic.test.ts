// deno test -A supabase/functions/lifecycle/logic.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { config, decide, type Facts, sameSecret, SEQUENCE, unsubscribeLinks, unsubscribeToken, validUnsubscribe } from "./logic.ts";

const H = 3_600_000, D = 24 * H;
const NOW = new Date("2026-10-20T08:00:00Z");
const facts = (o: Partial<Facts> & { ageMs: number }): Facts => ({
  user_id: "0b6f6a5e-1d2c-4a8e-9f3b-2c1d0e9f8a7b", email: "sara@example.com",
  signed_up_at: new Date(NOW.getTime() - o.ageMs), has_note: true, ai_connected: false, ai_edited: false,
  history_opened: false, unsubscribed: false, last_sent_at: null, sent: [], ...o,
});

Deno.test("each email has its moment: connect from 12 hours, templates from day 3, Undo from day 7", () => {
  assertEquals(decide(facts({ ageMs: 11 * H }), NOW), null);
  assertEquals(decide(facts({ ageMs: 13 * H }), NOW), "connect");
  assertEquals(decide(facts({ ageMs: 3 * D, ai_connected: true }), NOW), "templates");
  assertEquals(decide(facts({ ageMs: 7 * D, ai_connected: true, ai_edited: true }), NOW), "undo");
});

Deno.test("an account with no note after a day gets the stuck email, and nothing else", () => {
  assertEquals(decide(facts({ ageMs: 20 * H, has_note: false }), NOW), null);
  assertEquals(decide(facts({ ageMs: 25 * H, has_note: false }), NOW), "stuck");
  assertEquals(decide(facts({ ageMs: 9 * D, has_note: false, sent: ["stuck"], last_sent_at: new Date(NOW.getTime() - 8 * D) }), NOW), null);
});

Deno.test("an email whose goal happened is never sent", () => {
  assertEquals(decide(facts({ ageMs: 2 * D, ai_connected: true }), NOW), null);
  assertEquals(decide(facts({ ageMs: 4 * D, ai_connected: true, ai_edited: true }), NOW), null);
  assertEquals(decide(facts({ ageMs: 8 * D, ai_connected: true, ai_edited: true, history_opened: true }), NOW), null);
  assertEquals(decide(facts({ ageMs: 2 * D, has_note: true }), NOW), "connect");
});

Deno.test("at most one email in seven days: the next one waits", () => {
  const sentDay1 = { sent: ["connect"], last_sent_at: new Date(NOW.getTime() - 2 * D) };
  assertEquals(decide(facts({ ageMs: 3 * D, ...sentDay1 }), NOW), null);
  assertEquals(decide(facts({ ageMs: 8 * D, sent: ["connect"], last_sent_at: new Date(NOW.getTime() - 7 * D) }), NOW), "templates");
});

Deno.test("never the same email twice, never after unsubscribing, never without an address", () => {
  assertEquals(decide(facts({ ageMs: 2 * D, sent: ["connect"], last_sent_at: new Date(NOW.getTime() - 30 * D) }), NOW), null);
  assertEquals(decide(facts({ ageMs: 2 * D, unsubscribed: true }), NOW), null);
  assertEquals(decide(facts({ ageMs: 2 * D, email: null }), NOW), null);
});

Deno.test("old accounts are left alone: each email has a last day", () => {
  for (const step of SEQUENCE) assert(step.until <= 28 * D, step.kind);
  assertEquals(decide(facts({ ageMs: 29 * D }), NOW), null);
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
