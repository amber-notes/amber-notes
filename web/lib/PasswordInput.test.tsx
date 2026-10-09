// @vitest-environment happy-dom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PasswordInput } from "./PasswordInput";
import { Field } from "./ui";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });

function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(node));
}
const input = () => document.querySelector("input") as HTMLInputElement;
const eye = () => document.querySelector("button[aria-pressed]") as HTMLButtonElement;

describe("a password input's eye button", () => {
  it("starts hidden, and says what pressing it does", () => {
    render(<PasswordInput id="pw" autoComplete="current-password" defaultValue="" />);
    expect(input().type).toBe("password");
    expect(eye().type, "never submits a form").toBe("button");
    expect(eye().getAttribute("aria-label")).toBe("Show password");
    expect(eye().getAttribute("aria-pressed")).toBe("false");
    expect(eye().getAttribute("aria-controls")).toBe("pw");
    expect(eye().querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(input().compareDocumentPosition(eye()) & Node.DOCUMENT_POSITION_FOLLOWING, "reached by Tab after the field").toBeTruthy();
  });

  it("shows and hides by changing only the input's type, so a password manager sees the same field", () => {
    render(<PasswordInput id="pw" name="password" autoComplete="new-password" defaultValue="made up words" />);
    const before = input();
    act(() => eye().click());
    expect(input()).toBe(before);
    expect(input().type).toBe("text");
    expect(input().value).toBe("made up words");
    expect([input().id, input().name, input().getAttribute("autocomplete")]).toEqual(["pw", "password", "new-password"]);
    expect(eye().getAttribute("aria-label")).toBe("Hide password");
    expect(eye().getAttribute("aria-pressed")).toBe("true");
    expect(eye().querySelectorAll("svg path").length, "the eye gets its slash").toBe(2);
    act(() => eye().click());
    expect(input().type).toBe("password");
    expect(eye().querySelectorAll("svg path").length).toBe(1);
  });

  it("does not send the form it is in", () => {
    const sent = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(<form onSubmit={sent}><PasswordInput id="pw" defaultValue="made up words" /><button type="submit">Go</button></form>);
    act(() => eye().click());
    expect(sent).not.toHaveBeenCalled();
  });

  it("keeps the keyboard and the caret in the field when pressed", () => {
    render(<PasswordInput id="pw" defaultValue="made up words" />);
    act(() => { input().focus(); input().setSelectionRange(4, 4); });
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => { eye().dispatchEvent(press); });
    expect(press.defaultPrevented, "the press does not take focus from the field").toBe(true);
    act(() => eye().click());
    expect(document.activeElement).toBe(input());
    expect([input().selectionStart, input().selectionEnd]).toEqual([4, 4]);
  });

  it("leaves the tab order with its field, and hands the input to a ref", () => {
    const ref = createRef<HTMLInputElement>();
    render(<PasswordInput id="pw" ref={ref} tabIndex={-1} defaultValue="" />);
    expect(ref.current).toBe(input());
    expect([input().tabIndex, eye().tabIndex]).toEqual([-1, -1]);
  });

  it("is in every password Field, and in no other", () => {
    render(<><Field id="a" name="a" label="Password" type="password" hint="At least 12 characters." /><Field id="b" name="b" label="Email" type="email" /></>);
    expect([...document.querySelectorAll("button[aria-pressed]")].map((b) => b.getAttribute("aria-controls"))).toEqual(["a"]);
    const a = document.getElementById("a") as HTMLInputElement;
    expect(a.type).toBe("password");
    expect(a.getAttribute("aria-describedby")).toBe("a-hint");
    expect(document.querySelector('label[for="a"]')!.textContent, "the eye's name is not part of the field's").toBe("Password");
  });
});
