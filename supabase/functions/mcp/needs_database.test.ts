import { assertEquals } from "jsr:@std/assert@1";

Deno.env.set("SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
const { needsDatabase } = await import("./server.ts");

const F = "https://abcdefghijklmnopqrst.supabase.co/functions/v1/mcp";
const TOKEN = "Bearer amb_at_" + "a".repeat(64);
const req = (path: string, method = "GET", headers: Record<string, string> = {}) => new Request(F + path, { method, headers });

Deno.test("requests that never touch the database don't wait for a connection", () => {
  for (const r of [
    req("/.well-known/oauth-authorization-server"), req("/.well-known/oauth-protected-resource/mcp"), req("/.well-known/openid-configuration"),
    req("/.well-known/mcp/server-card.json"), req("", "OPTIONS"), req("/token", "OPTIONS"),
    // Unauthenticated or not POST: a 401, 405 or 204 with no lookup.
    req(""), req("", "POST"), req("", "GET", { authorization: TOKEN }), req("", "DELETE", { authorization: TOKEN }),
    // Not a token: refused without a lookup.
    req("", "POST", { authorization: "Bearer amb_at_x" }),
  ]) assertEquals(needsDatabase(r), false, `${r.method} ${new URL(r.url).pathname}`);
});

Deno.test("requests that do, do", () => {
  for (const r of [
    req("", "POST", { authorization: TOKEN }), req("/register", "POST"), req("/authorize"), req("/token", "POST"), req("/revoke", "POST"),
    req("/connect/status", "POST"), req("/connect/label"), req("/connect/ask", "POST"), req("/connect/decide", "POST"),
  ]) assertEquals(needsDatabase(r), true, `${r.method} ${new URL(r.url).pathname}`);
});
