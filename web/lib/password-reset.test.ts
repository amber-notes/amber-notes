import { describe, expect, it, vi } from "vitest";
import { abandon, authAPI, emailFromFragment, newPending, passwordProblem, readResetLink, requestLink, savePassword, type ResetAuth } from "./password-reset";

const q = (s: string) => new URLSearchParams(s);
const none = q("");
const GOOD = "a long enough password";

function fakeAuth(over: Partial<{ [K in keyof ResetAuth]: ReturnType<typeof vi.fn<ResetAuth[K]>> }> = {}) {
  return {
    verify: vi.fn<ResetAuth["verify"]>(async () => "access-token"),
    setPassword: vi.fn<ResetAuth["setPassword"]>(async () => "ok"),
    signOut: vi.fn<ResetAuth["signOut"]>(async () => undefined),
    ...over,
  };
}

describe("reading the link (all a mail scanner gets to)", () => {
  it("keeps a recovery token hash from the fragment to spend later", () => {
    expect(readResetLink(none, q("token_hash=made-up-token-hash&type=recovery"))).toEqual({ kind: "token", tokenHash: "made-up-token-hash" });
  });
  it("doesn't take a token from the query, where server logs would have it", () => {
    expect(readResetLink(q("token_hash=made-up-token-hash&type=recovery"), none).kind).toBe("refused");
  });
  it("calls a link Supabase refused, or a mangled one, no longer working", () => {
    expect(readResetLink(q("error=access_denied&error_code=otp_expired"), none).kind).toBe("refused");
    expect(readResetLink(none, q("error_code=otp_expired")).kind).toBe("refused");
    expect(readResetLink(none, q("token_hash=abc123def456&type=signup")).kind).toBe("refused");
    expect(readResetLink(none, q("token_hash=<script>&type=recovery")).kind).toBe("refused");
  });
  it("is the request form with no link at all", () => {
    expect(readResetLink(none, none).kind).toBe("none");
  });
  it("takes an email handed over in the fragment, and nothing that isn't one", () => {
    expect(emailFromFragment(q("email=sara%40example.com"))).toBe("sara@example.com");
    expect(emailFromFragment(q("email=nope"))).toBe("");
    expect(emailFromFragment(none)).toBe("");
  });
});

describe("the new password", () => {
  it("asks for 12 to 72 characters, as the apps and Supabase do", () => {
    expect(passwordProblem("short")).toBe("Use at least 12 characters.");
    expect(passwordProblem("x".repeat(12))).toBeNull();
    expect(passwordProblem("x".repeat(73))).toBe("Use 72 characters or fewer.");
  });
});

describe("Save", () => {
  it("spends the link, sets the password, then ends the session, in that order", async () => {
    const auth = fakeAuth();
    expect(await savePassword(newPending("t1"), GOOD, auth)).toEqual({ kind: "done" });
    expect(auth.verify).toHaveBeenCalledWith("t1");
    expect(auth.setPassword).toHaveBeenCalledWith("access-token", GOOD);
    expect(auth.signOut).toHaveBeenCalledWith("access-token");
    expect(auth.verify.mock.invocationCallOrder[0]).toBeLessThan(auth.setPassword.mock.invocationCallOrder[0]);
    expect(auth.setPassword.mock.invocationCallOrder[0]).toBeLessThan(auth.signOut.mock.invocationCallOrder[0]);
  });

  it("never spends the link on a password that's too short", async () => {
    const auth = fakeAuth();
    expect(await savePassword(newPending("t2"), "short", auth)).toEqual({ kind: "error", message: "Use at least 12 characters." });
    expect(auth.verify).not.toHaveBeenCalled();
  });

  it("says the link no longer works when it was used or expired, and sets nothing", async () => {
    const auth = fakeAuth({ verify: vi.fn<ResetAuth["verify"]>(async () => null) });
    expect(await savePassword(newPending("t3"), GOOD, auth)).toEqual({ kind: "expired" });
    expect(auth.setPassword).not.toHaveBeenCalled();
  });

  it("spends the link once across a double press", async () => {
    const auth = fakeAuth();
    const pending = newPending("t4");
    const [a, b] = await Promise.all([savePassword(pending, GOOD, auth), savePassword(pending, GOOD, auth)]);
    expect([a, b]).toEqual([{ kind: "done" }, { kind: "done" }]);
    expect(auth.verify).toHaveBeenCalledOnce();
    expect(auth.setPassword).toHaveBeenCalledOnce();
  });

  it("keeps the session for another try when the password is refused", async () => {
    const setPassword = vi.fn<ResetAuth["setPassword"]>().mockResolvedValueOnce("same").mockResolvedValueOnce("ok");
    const auth = fakeAuth({ setPassword });
    const pending = newPending("t5");
    expect(await savePassword(pending, GOOD, auth)).toEqual({ kind: "error", message: "That's the password you have now. Choose a different one." });
    expect(await savePassword(pending, `${GOOD}!`, auth)).toEqual({ kind: "done" });
    expect(auth.verify).toHaveBeenCalledOnce();
  });

  it("says when it can't reach the server, without calling the link dead", async () => {
    const auth = fakeAuth({ verify: vi.fn<ResetAuth["verify"]>(async () => { throw new Error("offline"); }) });
    const outcome = await savePassword(newPending("t6"), GOOD, auth);
    expect(outcome.kind).toBe("error");
  });
});

describe("leaving the page before Save finished", () => {
  it("ends the session the link opened, once", async () => {
    const auth = fakeAuth({ setPassword: vi.fn<ResetAuth["setPassword"]>(async () => "weak") });
    const pending = newPending("t7");
    await savePassword(pending, GOOD, auth);
    expect(pending.session).toBe("access-token");
    abandon(pending, auth);
    abandon(pending, auth);
    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(auth.signOut).toHaveBeenCalledWith("access-token");
  });
  it("has nothing to end when the link wasn't spent", () => {
    const auth = fakeAuth();
    abandon(newPending("t8"), auth);
    abandon(null, auth);
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});

describe("authAPI, against Supabase Auth's endpoints", () => {
  function server(answers: Record<string, { status: number; body?: unknown }>) {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const key = `${init.method} ${new URL(url).pathname}`;
      const a = answers[key] ?? { status: 404 };
      return new Response(a.body === undefined ? null : JSON.stringify(a.body), { status: a.status });
    });
    return { calls, f: f as unknown as typeof fetch };
  }

  it("verifies the token hash as a recovery, then sets the password with the session it got", async () => {
    const { calls, f } = server({ "POST /auth/v1/verify": { status: 200, body: { access_token: "at" } }, "PUT /auth/v1/user": { status: 200, body: {} } });
    const api = authAPI("https://ref.supabase.co/", "anon", f);
    expect(await api.verify("th")).toBe("at");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ type: "recovery", token_hash: "th" });
    expect(new Headers(calls[0].init.headers).get("apikey")).toBe("anon");
    expect(await api.setPassword("at", GOOD)).toBe("ok");
    expect(new Headers(calls[1].init.headers).get("authorization")).toBe("Bearer at");
  });

  it("reads Supabase's refusals", async () => {
    const { f } = server({
      "POST /auth/v1/verify": { status: 403, body: { code: 403, error_code: "otp_expired" } },
      "PUT /auth/v1/user": { status: 422, body: { code: 422, error_code: "same_password" } },
    });
    const api = authAPI("https://ref.supabase.co", "anon", f);
    expect(await api.verify("th")).toBeNull();
    expect(await api.setPassword("at", GOOD)).toBe("same");
  });

  it("ends only this session", async () => {
    const { calls, f } = server({ "POST /auth/v1/logout": { status: 204 } });
    await authAPI("https://ref.supabase.co", "anon", f).signOut("at");
    expect(calls[0].url).toBe("https://ref.supabase.co/auth/v1/logout?scope=local");
    expect(calls[0].init.keepalive).toBe(true);
  });
});

describe("asking for a link", () => {
  it("posts the email to the site's own route and says sent", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await requestLink(" sara@example.com ", f as unknown as typeof fetch)).toBe("sent");
    expect(f).toHaveBeenCalledWith("/reset-password/request", expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "sara@example.com" }) }));
  });
  it("doesn't ask with something that isn't an email", async () => {
    const f = vi.fn();
    expect(await requestLink("sara", f as unknown as typeof fetch)).toBe("invalid");
    expect(f).not.toHaveBeenCalled();
  });
  it("says when the request didn't get through", async () => {
    expect(await requestLink("a@b.co", vi.fn(async () => new Response("{}", { status: 502 })) as unknown as typeof fetch)).toBe("failed");
    expect(await requestLink("a@b.co", vi.fn(async () => { throw new TypeError("offline"); }) as unknown as typeof fetch)).toBe("failed");
  });
});
