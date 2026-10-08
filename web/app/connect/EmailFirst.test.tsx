// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { afterCheck, parseEmailStatus, type EmailStatus } from "@/lib/connect-flow";
import { EmailFirst } from "./ConnectScreens";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

/// The form as a page holds it: its own email and password, and a sign-in that records what it got.
function render(status: EmailStatus | null, prefill = { email: "", password: "" }) {
  const signedIn: { email: string; password: string }[] = [];
  const asked: string[] = [];
  function Page() {
    const [email, setEmail] = useState(prefill.email);
    const [password, setPassword] = useState(prefill.password);
    return (
      <EmailFirst
        email={email} password={password} onEmail={setEmail} onPassword={setPassword} onApple={() => {}}
        busy={false} ready failure={null}
        onSubmit={(e) => { e.preventDefault(); signedIn.push({ email, password }); }}
        check={async (e) => { asked.push(e); return status; }}
      />
    );
  }
  act(() => root.render(<Page />));
  return { signedIn, asked };
}

const field = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)!;
const type = (id: string, value: string) => {
  const input = field(id);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const submit = () => act(async () => container.querySelector("form")!.requestSubmit());
const buttonText = () => container.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent;
const hidden = (id: string) => field(id).closest("label")!.getAttribute("aria-hidden") === "true";

describe("email first, as the app does it", () => {
  it("reads the account-status answer the way the app does, and shows a password when it can't say", () => {
    expect(parseEmailStatus({ exists: true, password: true })).toBe("password");
    expect(parseEmailStatus({ exists: true, password: false })).toBe("apple");
    expect(parseEmailStatus({ exists: false, password: false })).toBe("none");
    for (const bad of [null, {}, { exists: "yes", password: true }, { error: "slow down" }]) expect(parseEmailStatus(bad)).toBeNull();
    expect(afterCheck(null)).toEqual({ kind: "password", fallback: true });
  });

  it("starts with one Email field and Continue; the password field waits, out of sight and out of the tab order", () => {
    render("password");
    expect(buttonText()).toBe("Continue");
    expect(hidden("connect-password")).toBe(true);
    expect(field("connect-password").tabIndex).toBe(-1);
    // Both fields in one form, with what password managers look for.
    expect(field("connect-email").getAttribute("autocomplete")).toBe("username");
    expect(field("connect-password").getAttribute("autocomplete")).toBe("current-password");
    expect(field("connect-email").form).toBe(field("connect-password").form);
  });

  it("an account with a password: the password field opens in place, focused, and the button signs in", async () => {
    const { signedIn, asked } = render("password");
    act(() => type("connect-email", "sara@example.com"));
    await submit();
    expect(asked).toEqual(["sara@example.com"]);
    expect(hidden("connect-password")).toBe(false);
    expect(document.activeElement).toBe(field("connect-password"));
    expect(buttonText()).toBe("Sign in");
    expect(signedIn).toEqual([]);
    act(() => type("connect-password", "correct horse"));
    await submit();
    expect(signedIn).toEqual([{ email: "sara@example.com", password: "correct horse" }]);
  });

  it("offers Forgot password? only at the password, in a new tab with the email in the fragment", async () => {
    render("password");
    const forgot = () => [...document.querySelectorAll("a")].find((a) => a.textContent === "Forgot password?");
    expect(forgot()).toBeUndefined();
    act(() => type("connect-email", "sara+notes@example.com"));
    await submit();
    expect(forgot()?.getAttribute("href")).toBe("/reset-password#email=sara%2Bnotes%40example.com");
    expect(forgot()?.target).toBe("_blank");
  });

  it("a password manager that fills both at once signs in with one Continue", async () => {
    const { signedIn } = render("password", { email: "sara@example.com", password: "correct horse" });
    await submit();
    expect(signedIn).toEqual([{ email: "sara@example.com", password: "correct horse" }]);
  });

  it("the email stays editable after the password opens, and changing it starts over", async () => {
    const { asked } = render("password");
    act(() => type("connect-email", "sara@example.com"));
    await submit();
    act(() => type("connect-email", "emma@example.com"));
    expect(buttonText()).toBe("Continue");
    expect(hidden("connect-password")).toBe(true);
    await submit();
    expect(asked).toEqual(["sara@example.com", "emma@example.com"]);
  });

  it("no account: says so plainly, points to the app, and never offers a web sign-up", async () => {
    const { signedIn } = render("none");
    act(() => type("connect-email", "new@example.com"));
    await submit();
    expect(container.textContent).toContain("No Amber Notes account uses this email.");
    expect(container.textContent).toContain("Get Amber Notes, sign up there, then connect again.");
    const get = [...container.querySelectorAll("a")].find((a) => a.textContent === "Get Amber Notes")!;
    expect(get.getAttribute("href")).toMatch(/^(\/download|https:\/\/apps\.apple\.com\/)/);
    expect(container.querySelector('button[type="submit"]')).toBeNull();
    expect(hidden("connect-password")).toBe(true);
    expect(container.textContent).not.toMatch(/create|sign up here|new password/i);
    expect(container.querySelector('[autocomplete="new-password"]')).toBeNull();
    await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Use a different email")!.click());
    expect(buttonText()).toBe("Continue");
    expect(signedIn).toEqual([]);
  });

  it("an Apple account: points to Sign in with Apple, with no password field", async () => {
    render("apple");
    act(() => type("connect-email", "apple@example.com"));
    await submit();
    expect(container.textContent).toContain("This email signs in with Apple or Google. Use one of the buttons above.");
    expect(hidden("connect-password")).toBe(true);
    expect(container.querySelector('button[type="submit"]')).toBeNull();
  });

  it("when the check can't answer, the password field opens so nobody is stuck", async () => {
    render(null);
    act(() => type("connect-email", "sara@example.com"));
    await submit();
    expect([hidden("connect-password"), buttonText()]).toEqual([false, "Sign in"]);
  });

  it("asks nothing about something that isn't an email", async () => {
    const { asked } = render("password");
    act(() => type("connect-email", "sara"));
    await submit();
    expect(asked).toEqual([]);
  });
});
