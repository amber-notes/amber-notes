// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailStatus } from "@/lib/connect-flow";
import { SignIn } from "./ConnectScreens";

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

/// The buttons and the email form as a page holds them, with what each way in was asked to do.
function render(status: EmailStatus | null) {
  const used: string[] = [];
  function Page() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    return (
      <SignIn
        email={email} password={password} onEmail={setEmail} onPassword={setPassword}
        onApple={() => used.push("apple")} onGoogle={() => used.push("google")} busy={false} ready failure={null}
        onSubmit={(e) => { e.preventDefault(); used.push(`password:${email}:${password}`); }}
        check={async () => status}
      />
    );
  }
  act(() => root.render(<Page />));
  return used;
}

const field = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)!;
const type = (id: string, value: string) => {
  const input = field(id);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const submit = () => act(async () => container.querySelector("form")!.requestSubmit());
const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
/// The buttons with words on them; the password field's eye is checked on its own.
const buttons = () => [...container.querySelectorAll("button:not([aria-pressed])")].map((b) => b.textContent?.trim());
const BACK = "Other ways to sign in";

describe("the ways to sign in, at one height", () => {
  it("starts with Apple, Google and the email form, and no way back to show", () => {
    render("password");
    expect(buttons()).toEqual(["Sign in with Apple", "Sign in with Google", "Continue"]);
    expect(container.textContent).toContain("or with email");
  });

  it("typing an email moves nothing: the buttons stay until the email is the way in", () => {
    render("password");
    act(() => type("connect-email", "sara@example.com"));
    expect(buttons()).toEqual(["Sign in with Apple", "Sign in with Google", "Continue"]);
  });

  it("an account with a password: the buttons and the divider leave, and the same email field stays", async () => {
    render("password");
    const email = field("connect-email");
    act(() => type("connect-email", "sara@example.com"));
    await submit();
    expect(buttons()).toEqual(["Sign in", BACK]);
    expect(container.textContent).not.toContain("or with email");
    expect(field("connect-email")).toBe(email);
    expect(document.activeElement).toBe(field("connect-password"));
  });

  it("nothing hidden can take focus: the buttons are gone, and what holds the height is inert and empty of controls", async () => {
    render("password");
    act(() => type("connect-email", "sara@example.com"));
    await submit();
    expect(button("Sign in with Apple")).toBeUndefined();
    expect(button("Sign in with Google")).toBeUndefined();
    const sizer = container.querySelector("[inert]")!;
    expect(sizer.getAttribute("aria-hidden")).toBe("true");
    expect(sizer.querySelectorAll("button, a, select, textarea, input:not([disabled]), [tabindex]:not([tabindex='-1'])").length).toBe(0);
    expect(sizer.textContent?.trim()).toBe("");
    // Everything a keyboard can reach is outside it.
    for (const el of container.querySelectorAll("button, a, input:not([disabled])")) expect(sizer.contains(el)).toBe(false);
  });

  it("Other ways to sign in brings the buttons back, working, with the keyboard on the first one", async () => {
    const used = render("password");
    act(() => type("connect-email", "sara@example.com"));
    await submit();
    act(() => type("connect-password", "correct horse"));
    const back = button(BACK)!;
    expect(back.type).toBe("button");
    expect(back.tabIndex).toBe(0);
    await act(async () => back.click());
    expect(buttons()).toEqual(["Sign in with Apple", "Sign in with Google", "Continue"]);
    expect(document.activeElement).toBe(button("Sign in with Apple"));
    // The email is kept; the password typed so far is not.
    expect(field("connect-email").value).toBe("sara@example.com");
    expect(field("connect-password").value).toBe("");
    act(() => button("Sign in with Google")!.click());
    expect(used).toEqual(["google"]);
  });

  it("changing the email after that keeps the form where it is, with the way back", async () => {
    render("password");
    act(() => type("connect-email", "sara@example.com"));
    await submit();
    act(() => type("connect-email", "emma@example.com"));
    expect(buttons()).toEqual(["Continue", BACK]);
  });

  it("no account: the form stands alone, with a different email or the other ways to choose", async () => {
    render("none");
    act(() => type("connect-email", "new@example.com"));
    await submit();
    expect(buttons()).toEqual(["Use a different email", BACK]);
    await act(async () => button("Use a different email")!.click());
    expect(buttons()).toEqual(["Continue", BACK]);
  });

  it("an account that signs in with Apple or Google keeps the buttons its message points to", async () => {
    render("apple");
    act(() => type("connect-email", "apple@example.com"));
    await submit();
    expect(buttons()).toEqual(["Sign in with Apple", "Sign in with Google", "Use a different email"]);
    expect(container.textContent).toContain("Use one of the buttons above.");
  });

  it("an account found to use Apple or Google after the form stood alone gets the buttons back", async () => {
    let status: EmailStatus = "password";
    function Page() {
      const [email, setEmail] = useState("");
      const [password, setPassword] = useState("");
      return (
        <SignIn
          email={email} password={password} onEmail={setEmail} onPassword={setPassword} onApple={() => {}} onGoogle={() => {}}
          busy={false} ready failure={null} onSubmit={(e) => e.preventDefault()} check={async () => status}
        />
      );
    }
    act(() => root.render(<Page />));
    act(() => type("connect-email", "sara@example.com"));
    await submit();
    expect(button("Sign in with Apple")).toBeUndefined();
    status = "apple";
    act(() => type("connect-email", "apple@example.com"));
    await submit();
    expect(buttons()).toEqual(["Sign in with Apple", "Sign in with Google", "Use a different email"]);
  });
});
