// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResetAuth } from "@/lib/password-reset";
import ResetPassword, { type Screen } from "./ResetPassword";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GOOD = "a long enough password";
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });

function fakeAuth(over: Partial<ResetAuth> = {}) {
  return { verify: vi.fn(async () => "at" as string | null), setPassword: vi.fn(async () => "ok" as const), signOut: vi.fn(async () => undefined), ...over } satisfies ResetAuth;
}

async function open(address: string, initial: Screen, auth = fakeAuth(), send = vi.fn(async (_email: string): Promise<"sent" | "invalid" | "failed"> => "sent")) {
  window.history.replaceState(null, "", address);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<ResetPassword initial={initial} supabaseURL="https://ref.supabase.co" anonKey="anon" auth={auth} send={send} />));
  return { auth, send, host };
}

const text = () => document.body.textContent ?? "";
const input = (id: string) => document.getElementById(id) as HTMLInputElement;
async function type(id: string, value: string) {
  await act(async () => {
    const el = input(id);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const MISMATCH = "The two passwords don't match.";
const save = () => document.querySelector('button[type="submit"]') as HTMLButtonElement;
const said = () => document.getElementById("confirm-error")!.textContent;
async function leave(id: string) {
  await act(async () => { input(id).focus(); });
  await act(async () => { input(id).blur(); });
}
async function pressReturn(id: string) {
  let event!: KeyboardEvent;
  await act(async () => {
    event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    input(id).dispatchEvent(event);
  });
  return event;
}
async function submit() {
  await act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
}

describe("the reset page", () => {
  it("draws nothing on the server: the token is in the fragment, which only the browser reads", () => {
    expect(renderToStaticMarkup(<ResetPassword initial="opening" supabaseURL="" anonKey="" />)).toBe("");
  });

  it("opening the link spends nothing (what Safe Links and other scanners do)", async () => {
    const { auth } = await open("/reset-password#token_hash=abc123def456&type=recovery", "opening");
    expect(text()).toContain("Choose a new password");
    expect(auth.verify).not.toHaveBeenCalled();
    expect(auth.setPassword).not.toHaveBeenCalled();
    expect(window.location.hash, "the token leaves the address bar once read").toBe("");
    expect(input("password").getAttribute("autocomplete")).toBe("new-password");
  });

  it("leaving after the link was spent but before the password was set ends that session", async () => {
    const { auth } = await open("/reset-password#token_hash=abc123def456&type=recovery", "opening", fakeAuth({ setPassword: vi.fn(async () => "weak" as const) }));
    await type("password", GOOD);
    await type("confirm", GOOD);
    await submit();
    expect(auth.signOut).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    expect(auth.signOut).toHaveBeenCalledWith("at");
  });

  it("Save spends the link, changes the password and says so, and the token leaves the address bar", async () => {
    const { auth } = await open("/reset-password#token_hash=abc123def456&type=recovery", "opening");
    await type("password", GOOD);
    await type("confirm", GOOD);
    await submit();
    expect(auth.verify).toHaveBeenCalledWith("abc123def456");
    expect(auth.setPassword).toHaveBeenCalledWith("at", GOOD);
    expect(text()).toContain("Your password is changed");
    expect(text()).toContain("Sign in with it on your iPhone or Mac.");
    expect(window.location.hash).toBe("");
  });

  it("a short password is said under the field and the link stays unspent", async () => {
    const { auth } = await open("/reset-password#token_hash=abc123def456&type=recovery", "opening");
    await type("password", "short");
    await submit();
    expect(text()).toContain("Use at least 12 characters.");
    expect(input("password").getAttribute("aria-invalid")).toBe("true");
    expect(auth.verify).not.toHaveBeenCalled();
  });

  it("shows and hides both passwords together", async () => {
    await open("/reset-password#token_hash=abc123def456&type=recovery", "opening");
    const toggle = document.querySelector('button[aria-controls="password confirm"]') as HTMLButtonElement;
    expect([input("password").type, input("confirm").type]).toEqual(["password", "password"]);
    await act(async () => toggle.click());
    expect([input("password").type, input("confirm").type]).toEqual(["text", "text"]);
    expect(toggle.textContent).toBe("Hide");
    await act(async () => toggle.click());
    expect([input("password").type, input("confirm").type]).toEqual(["password", "password"]);
  });

  it("asks for the password twice: both fields are labelled and filled as a new password", async () => {
    await open("/reset-password#token_hash=abc123def456&type=recovery", "opening");
    expect(document.querySelector('label[for="confirm"]')!.textContent).toBe("Confirm new password");
    expect(input("confirm").getAttribute("autocomplete")).toBe("new-password");
    expect(save().disabled, "nothing typed yet").toBe(true);
    await type("password", GOOD);
    expect(save().disabled, "typed once").toBe(true);
    expect(said()).toBe("");
  });

  it("a second password that differs is said once it is as long as the first, not while it is typed", async () => {
    const { auth } = await open("/reset-password#token_hash=abc123def456&type=recovery", "opening");
    await type("password", GOOD);
    await type("confirm", "a long enough pass");
    expect(said(), "still typing").toBe("");
    expect(input("confirm").hasAttribute("aria-invalid")).toBe(false);
    await type("confirm", "a long enough passwerd");
    expect(said()).toBe(MISMATCH);
    expect(input("confirm").getAttribute("aria-invalid")).toBe("true");
    expect(input("confirm").getAttribute("aria-describedby")).toBe("confirm-error");
    expect(document.getElementById("confirm-error")!.getAttribute("role")).toBe("status");
    expect(save().disabled).toBe(true);
    await submit();
    expect(auth.verify, "the link stays unspent").not.toHaveBeenCalled();
    expect(auth.setPassword).not.toHaveBeenCalled();
    expect(text()).toContain("Choose a new password");
  });

  it("a shorter second password that differs is said when its field is left, and unsaid when it is taken up again", async () => {
    await open("/reset-password#token_hash=abc123def456&type=recovery", "opening");
    await type("password", GOOD);
    await type("confirm", "a long");
    expect(said()).toBe("");
    await leave("confirm");
    expect(said()).toBe(MISMATCH);
    await act(async () => { input("confirm").focus(); });
    expect(said()).toBe("");
  });

  it("leaving the second field empty says nothing", async () => {
    await open("/reset-password#token_hash=abc123def456&type=recovery", "opening");
    await type("password", GOOD);
    await leave("confirm");
    expect(said()).toBe("");
    expect(input("confirm").hasAttribute("aria-invalid")).toBe(false);
  });

  it("two matching passwords say nothing, enable Save and send the password once, without the second field", async () => {
    const { auth } = await open("/reset-password#token_hash=abc123def456&type=recovery", "opening");
    await type("password", GOOD);
    await type("confirm", GOOD);
    expect(said()).toBe("");
    expect(save().disabled).toBe(false);
    expect((await pressReturn("confirm")).defaultPrevented, "Return is left to the form").toBe(false);
    await submit();
    expect(auth.setPassword).toHaveBeenCalledTimes(1);
    expect(auth.setPassword).toHaveBeenCalledWith("at", GOOD);
    expect(text()).toContain("Your password is changed");
  });

  it("the request carries the password once and no second field", async () => {
    const sent: { url: string; body: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      sent.push({ url: String(url), body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ access_token: "at" }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    try {
      window.history.replaceState(null, "", "/reset-password#token_hash=abc123def456&type=recovery");
      const host = document.createElement("div");
      document.body.append(host);
      root = createRoot(host);
      await act(async () => root!.render(<ResetPassword initial="opening" supabaseURL="https://ref.supabase.co" anonKey="anon" />));
      await type("password", GOOD);
      await type("confirm", GOOD);
      await submit();
      const withPassword = sent.filter((r) => r.body.includes(GOOD));
      expect(withPassword.length).toBe(1);
      expect(JSON.parse(withPassword[0].body)).toEqual({ password: GOOD });
      for (const r of sent) expect(r.body).not.toContain("confirm");
    } finally { vi.unstubAllGlobals(); }
  });

  it("Return with something still wrong sends nothing and goes to the first field it is about", async () => {
    const { auth } = await open("/reset-password#token_hash=abc123def456&type=recovery", "opening");
    await type("password", "short");
    expect((await pressReturn("confirm")).defaultPrevented).toBe(true);
    expect(text()).toContain("Use at least 12 characters.");
    expect(document.activeElement).toBe(input("password"));
    await type("password", GOOD);
    await pressReturn("password");
    expect(document.activeElement, "the second field is next").toBe(input("confirm"));
    expect(said(), "an empty second field is not called a mismatch").toBe("");
    await type("confirm", "a long");
    await pressReturn("confirm");
    expect(said()).toBe(MISMATCH);
    expect(document.activeElement).toBe(input("confirm"));
    expect(auth.verify).not.toHaveBeenCalled();
  });

  it("a used or expired link: says so, and sends a new one", async () => {
    const send = vi.fn(async (_email: string): Promise<"sent" | "invalid" | "failed"> => "sent");
    await open("/reset-password#token_hash=abc123def456&type=recovery", "opening", fakeAuth({ verify: vi.fn(async () => null) }), send);
    await type("password", GOOD);
    await type("confirm", GOOD);
    await submit();
    expect(text()).toContain("This link no longer works");
    await type("email", "sara@example.com");
    await submit();
    expect(send).toHaveBeenCalledWith("sara@example.com");
    expect(text()).toContain("Check your email");
  });

  it("a link Supabase refused goes straight to the expired screen", async () => {
    await open("/reset-password#error=access_denied&error_code=otp_expired", "opening");
    expect(text()).toContain("This link no longer works");
  });

  it("asking for a link answers the same for any email, with the email from the fragment filled in", async () => {
    const { send } = await open("/reset-password#email=sara%40example.com", "opening");
    expect(input("email").value).toBe("sara@example.com");
    expect(window.location.hash).toBe("");
    await submit();
    expect(send).toHaveBeenCalledWith("sara@example.com");
    expect(text()).toContain("If an account uses sara@example.com, we've sent it a link to choose a new password. The link works for one hour.");
  });

  it("says when the request didn't go through", async () => {
    await open("/reset-password", "request", fakeAuth(), vi.fn(async (_email: string): Promise<"sent" | "invalid" | "failed"> => "failed"));
    await type("email", "sara@example.com");
    await submit();
    expect(text()).toContain("The link couldn't be sent. Try again in a moment.");
  });
});
