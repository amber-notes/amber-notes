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
    await submit();
    expect(auth.signOut).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    expect(auth.signOut).toHaveBeenCalledWith("at");
  });

  it("Save spends the link, changes the password and says so, and the token leaves the address bar", async () => {
    const { auth } = await open("/reset-password#token_hash=abc123def456&type=recovery", "opening");
    await type("password", GOOD);
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

  it("shows and hides the password", async () => {
    await open("/reset-password#token_hash=abc123def456&type=recovery", "opening");
    expect(input("password").type).toBe("password");
    await act(async () => (document.querySelector('button[aria-controls="password"]') as HTMLButtonElement).click());
    expect(input("password").type).toBe("text");
  });

  it("a used or expired link: says so, and sends a new one", async () => {
    const send = vi.fn(async (_email: string): Promise<"sent" | "invalid" | "failed"> => "sent");
    await open("/reset-password#token_hash=abc123def456&type=recovery", "opening", fakeAuth({ verify: vi.fn(async () => null) }), send);
    await type("password", GOOD);
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
