// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ResetChooser } from "./ResetChooser";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); act(() => root.render(<ResetChooser />)); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const pick = (label: string) => act(() => {
  const b = [...host.querySelectorAll("button")].find((x) => x.textContent === label);
  if (!b) throw new Error(`no button ${label}`);
  b.click();
});
const path = () => [...host.querySelectorAll('[role="group"]')].map((g) => g.getAttribute("aria-label"));

describe("which reset applies to you", () => {
  it("sends someone who still knows the password to Change Password, not Reset", () => {
    pick("Yes, I want a new one");
    expect(host.textContent).not.toContain("Change it");
    pick("Mac");
    expect(host.textContent).toContain("Change it, don't reset it");
    expect(path()).toEqual(["Notes, then Settings, then Change Password"]);
  });

  it("asks someone who forgot it to try the other ways first", () => {
    pick("No, I've forgotten it");
    pick("Not yet");
    expect(host.textContent).toContain("Try these before anything else");
    expect(host.querySelector('a[href="#try-these-first"]')).not.toBeNull();
  });

  it("ends in the reset steps for their device, and says old notes keep the old password", () => {
    pick("No, I've forgotten it");
    pick("Yes, none worked");
    pick("iPhone");
    expect(host.textContent).toContain("Your old locked notes stay locked with the old password");
    expect(path()).toEqual(["Settings, then Apps, then Notes, then Password, then The account, then Reset Password"]);
    expect(host.querySelector('a[href="#reset-on-iphone"]')).not.toBeNull();
    pick("Start again");
    expect(host.textContent).not.toContain("Reset it");
  });

  it("counts each answer as blog_helper_used, and nothing else", () => {
    for (const b of host.querySelectorAll("fieldset button")) expect(b.getAttribute("data-event")).toBe("blog_helper_used");
  });
});
