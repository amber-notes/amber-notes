// The APNs sender, against a fake Apple: deno test -A supabase/functions/_shared/apns.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { apnsSender, providerToken, type Push } from "./apns.ts";

async function newKey() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  // A throwaway key made just now, in the .p8 file's PEM form.
  const label = ["PRIVATE", "KEY"].join(" ");
  const pem = `-----BEGIN ${label}-----\n${btoa(String.fromCharCode(...der)).match(/.{1,64}/g)!.join("\n")}\n-----END ${label}-----\n`;
  return { pem, publicKey: pair.publicKey };
}
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4)), (c) => c.charCodeAt(0));

Deno.test("the provider token is an ES256 JWT Apple can check with the key's public half", async () => {
  const { pem, publicKey } = await newKey();
  const jwt = await providerToken(pem, "KEYID12345", "4UM3XVUN9Y", 1_790_000_000_000);
  const [h, c, sig] = jwt.split(".");
  assertEquals(JSON.parse(new TextDecoder().decode(fromB64url(h))), { alg: "ES256", kid: "KEYID12345" });
  assertEquals(JSON.parse(new TextDecoder().decode(fromB64url(c))), { iss: "4UM3XVUN9Y", iat: 1_790_000_000 });
  assert(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, fromB64url(sig), new TextEncoder().encode(`${h}.${c}`)));
});

Deno.test("without a key nothing is set up", () => {
  assertEquals(apnsSender(() => undefined), null);
});

Deno.test("pushes go to the token's server with the topic, and Apple's answers are sorted", async () => {
  const { pem } = await newKey();
  const seen: { url: string; headers: Headers; body: string }[] = [];
  let reply = () => new Response(null, { status: 200 });
  const fake = ((url: string, init: RequestInit) => {
    seen.push({ url, headers: new Headers(init.headers), body: String(init.body) });
    return Promise.resolve(reply());
  }) as unknown as typeof fetch;
  const env: Record<string, string> = { APNS_KEY_P8: pem, APNS_KEY_ID: "KEYID12345", APNS_TEAM_ID: "4UM3XVUN9Y" };
  const send = apnsSender((k) => env[k], fake)!;
  const push: Push = { token: "ab".repeat(32), environment: "sandbox", payload: { aps: { alert: { title: "t", body: "b" } }, ask: "x" }, collapseId: "x" };
  assertEquals(await send(push), "sent");
  assertEquals(seen[0].url, `https://api.sandbox.push.apple.com/3/device/${"ab".repeat(32)}`);
  assertEquals(seen[0].headers.get("apns-topic"), "dev.emilwagman.pane");
  assertEquals(seen[0].headers.get("apns-push-type"), "alert");
  assert(seen[0].headers.get("authorization")!.startsWith("bearer "));
  assertEquals(JSON.parse(seen[0].body), push.payload);
  assertEquals(await send({ ...push, environment: "production" }), "sent");
  assertEquals(new URL(seen[1].url).host, "api.push.apple.com");
  // The provider token is reused, not made for every push.
  assertEquals(seen[0].headers.get("authorization"), seen[1].headers.get("authorization"));
  reply = () => Response.json({ reason: "Unregistered" }, { status: 410 });
  assertEquals(await send(push), "gone");
  reply = () => Response.json({ reason: "BadDeviceToken" }, { status: 400 });
  assertEquals(await send(push), "gone");
  reply = () => Response.json({ reason: "TooManyRequests" }, { status: 429 });
  assertEquals(await send(push), "failed");
});
