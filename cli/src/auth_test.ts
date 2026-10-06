import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { authorizeURL, challengeOf, codeFrom } from "./auth.ts";
import { redact } from "./client.ts";

Deno.test("PKCE S256 matches RFC 7636 appendix B", async () => {
  assertEquals(await challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

Deno.test("the authorize address asks for a code with PKCE, for this server", () => {
  const u = new URL(authorizeURL({ issuer: "https://s", authorization_endpoint: "https://s/authorize", token_endpoint: "", registration_endpoint: "" },
    { clientId: "c1", redirect: "http://127.0.0.1:5555/callback", challenge: "x".repeat(43), state: "st", resource: "https://s" }));
  assertEquals(Object.fromEntries(u.searchParams), {
    response_type: "code", client_id: "c1", redirect_uri: "http://127.0.0.1:5555/callback", code_challenge: "x".repeat(43),
    code_challenge_method: "S256", state: "st", scope: "notes:read notes:write", resource: "https://s",
  });
});

Deno.test("the code comes back only with our state, from our issuer", () => {
  const back = (q: string) => `http://127.0.0.1:5555/callback?${q}`;
  assertEquals(codeFrom(back("state=st&iss=https%3A%2F%2Fs&code=amb_code_1"), "st", "https://s"), "amb_code_1");
  assertEquals(codeFrom(back("state=st&code=c"), "st", "https://s/"), "c");
  assertThrows(() => codeFrom(back("state=other&code=c"), "st", "https://s"), Error, "started somewhere else");
  assertThrows(() => codeFrom(back("state=st&iss=https%3A%2F%2Fevil&code=c"), "st", "https://s"), Error, "not https://s");
  assertThrows(() => codeFrom(back("state=st&error=access_denied"), "st", "https://s"), Error, "Declined in Amber Notes");
  assertThrows(() => codeFrom("not a url", "st", "https://s"), Error, "Copy the whole address");
  assertThrows(() => codeFrom(back("state=st"), "st", "https://s"), Error, "no code");
});

Deno.test("tokens never survive into a message", () => {
  const m = redact(`refused pane_${"a".repeat(64)} and amb_at_${"b".repeat(64)}, amb_rt_${"c".repeat(64)}`);
  assertEquals(m, "refused pane_… and amb_at_…, amb_rt_…");
  assertStringIncludes(redact("no token here"), "no token here");
});
