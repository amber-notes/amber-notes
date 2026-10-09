import { assert, assertEquals } from "jsr:@std/assert@1";
import { authLines, Digest, findings, functionPath, maskEmail, render, scrub } from "./daily-digest.ts";

function digest(over: Partial<Digest> = {}): Digest {
  return {
    start: new Date("2026-10-05T18:00:00Z"), end: new Date("2026-10-06T18:00:00Z"),
    accounts: { total: 16, new: 3, signed_in: 3 },
    auth: { actions: [], requests: [], providers: [], errors: [] },
    functions: [], slowest: [], events: [],
    mcp: { posts: [], refused_by: [], grants_used: 2, last_used: null, ai_edits: 4 },
    connect: { started: 0, signed_in: 0, approved: 0, finished: 0, stuck_without_device: 0, by_client: [], asks: [] },
    app: { table: true, failures: [] },
    email: { sends: [], resend: "" },
    database: [], gaps: [],
    ...over,
  };
}

Deno.test("emails keep their first letter and domain", () => {
  assertEquals(maskEmail("anna@example.com"), "a***@example.com");
  assertEquals(maskEmail("nobody"), "***");
  assertEquals(scrub("user anna.b@norditech.se failed"), "user a***@norditech.se failed");
});

Deno.test("scrub blanks ids, tokens and addresses, and keeps one table-safe line", () => {
  const s = scrub("note 3f2b0c1d-1234-4abc-8def-0123456789ab from 10.1.2.3\nBearer amb_at_abc | x");
  assertEquals(s, "note <id> from <address> Bearer <token> x");
  assertEquals(scrub("a".repeat(200)).length, 120);
});

Deno.test("function paths lose ids", () => {
  assertEquals(functionPath("/functions/v1/mcp/connect/3f2b0c1d-1234-4abc-8def-0123456789ab"), "mcp/connect/:id");
  assertEquals(functionPath("/functions/v1/lifecycle"), "lifecycle");
});

Deno.test("an auth error counts once, and a local copy of the site isn't a user", () => {
  const out = authLines([
    { path: "/callback", provider: "", status: "", error: "400: OAuth state parameter missing", msg: "request completed", from: "ambernotes.app", n: 1 },
    { path: "/callback", provider: "", status: "", error: "400: OAuth state parameter missing", msg: "400: OAuth state parameter missing", from: "ambernotes.app", n: 1 },
    { path: "/callback", provider: "", status: "", error: "400: OAuth state parameter missing", msg: "request completed", from: "127.0.0.1", n: 3 },
    { path: "/authorize", provider: "google", status: "", error: "", msg: "Redirecting to external provider", from: "ambernotes.app", n: 2 },
    { path: "/recover", provider: "", status: "200", error: "", msg: "request completed", from: "ambernotes.app", n: 5 },
  ]);
  assertEquals(out.errors, [{ path: "/callback", error: "400: OAuth state parameter missing", from: "ambernotes.app", n: 1 }]);
  assertEquals(out.providers, [{ provider: "google", n: 2 }]);
  assertEquals(out.requests[0], { path: "/recover", status: "200", n: 5 });
});

Deno.test("a connect funnel where nobody finished leads the report", () => {
  const d = digest({ connect: { started: 5, signed_in: 2, approved: 0, finished: 0, stuck_without_device: 2, by_client: [], asks: [] } });
  const f = findings(d);
  assertEquals(f[0], "Connecting an AI: 5 tries, none finished (2 signed in, 0 approved).");
  assert(f[1].startsWith("2 signed in to connect an AI on an account with no Amber Notes device"));
});

Deno.test("5xx, crashes and tool errors are findings; quiet days say so", () => {
  assertEquals(findings(digest()), []);
  const f = findings(digest({
    functions: [{ fn: "mcp", status: "500", n: 3 }, { fn: "mcp", status: "200", n: 90 }],
    events: [{ event: "tool_failed", tool: "edit_note", kind: "PostgresError", code: "40001", where: "", n: 2 },
      { event: "tool_error", tool: "edit_note", kind: "old_text_not_found", code: "", where: "", n: 7 }],
  }));
  assertEquals(f, [
    "Server errors: mcp 500 x3.",
    "Function failures: tool_failed edit_note (PostgresError 40001) x2.",
    "AI tool calls answered with an error: edit_note old_text_not_found x7.",
  ]);
  assert(render(digest()).includes("- Nothing the logs can see."));
});

Deno.test("the report has no dashes Emil would read as AI writing", () => {
  const md = render(digest({ database: [{ severity: "ERROR", message: "a — b", n: 1 }] }));
  assert(!/[–—]/.test(md));
});
