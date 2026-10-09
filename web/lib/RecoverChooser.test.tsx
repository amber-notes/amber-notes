// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RecoverChooser } from "./RecoverChooser";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); act(() => root.render(<RecoverChooser />)); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const pick = (label: string) => act(() => {
  const b = [...host.querySelectorAll("button")].find((x) => x.textContent === label);
  if (!b) throw new Error(`no button ${label}`);
  b.click();
});
const verdict = () => host.querySelector('[aria-live="polite"]')?.textContent ?? "";

describe("where did my note go", () => {
  it("sends someone who isn't sure it was deleted to search first", () => {
    pick("I'm not sure it was");
    expect(verdict()).toContain("Search all accounts");
    expect(host.querySelector('a[href="#make-sure"]')).not.toBeNull();
  });

  it("ends in Recently Deleted, with the steps for where they're looking", () => {
    pick("In the last 30 days");
    pick("iCloud");
    expect(verdict()).toBe("");
    pick("iPhone");
    expect(verdict()).toContain("tap Move");
    pick("Mac");
    expect(verdict()).toContain("drag the note to another folder");
    pick("A browser");
    expect(verdict()).toContain("select Recover");
  });

  it("doesn't send On My iPhone notes to iCloud.com", () => {
    pick("In the last 30 days");
    pick("On My iPhone or Mac");
    pick("A browser");
    expect(verdict()).toContain("aren't on iCloud.com");
  });

  it("sends mail-account notes to Trash, whenever they were deleted", () => {
    for (const when of ["In the last 30 days", "Longer ago"]) {
      pick(when);
      pick("Gmail, Yahoo or other");
      expect(verdict()).toContain("Trash, in Mail");
    }
  });

  it("is honest that iCloud notes are gone after 30 days", () => {
    pick("Longer ago");
    pick("iCloud");
    expect(verdict()).toContain("can't be brought back");
    expect(host.textContent).not.toContain("Where are you looking?");
  });

  it("asks again from the account when the first answer changes", () => {
    pick("In the last 30 days");
    pick("iCloud");
    pick("iPhone");
    pick("Longer ago");
    expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toBe("Longer ago");
    expect(verdict()).toBe("");
  });
});
