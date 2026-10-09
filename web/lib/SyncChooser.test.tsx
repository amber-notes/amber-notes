// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SyncChooser } from "./SyncChooser";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); act(() => root.render(<SyncChooser />)); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const pick = (label: string) => act(() => {
  const b = [...host.querySelectorAll("button")].find((x) => x.textContent === label);
  if (!b) throw new Error(`no button ${label}`);
  b.click();
});
const path = () => [...host.querySelectorAll('[role="group"]')].map((g) => g.getAttribute("aria-label"));

describe("find what's stopping the sync", () => {
  it("sends someone who hasn't looked at icloud.com to look there, and asks nothing more", () => {
    pick("I haven't looked");
    expect(host.textContent).toContain("Look there first");
    expect(host.querySelectorAll("fieldset")).toHaveLength(1);
  });

  it("says a note under On My iPhone never syncs, and links the move", () => {
    pick("No, it's missing");
    expect(host.querySelector('[aria-live]')).toBeNull();
    pick("On My iPhone or On My Mac");
    expect(host.textContent).toContain("That note was never going to sync");
    expect(host.querySelector('a[href="/blog/move-apple-notes-to-icloud"]')).not.toBeNull();
  });

  it("sends a note in iCloud that never uploaded to the storage check", () => {
    pick("No, it's missing");
    pick("iCloud");
    expect(host.textContent).toContain("hasn't uploaded it");
    expect(host.querySelector('a[href="#storage"]')).not.toBeNull();
  });

  it("ends in the iCloud setting for the device that's missing the note", () => {
    pick("Yes, it's there");
    pick("No, or I'm not sure");
    expect(host.querySelector('[aria-live]')).toBeNull();
    pick("Mac");
    expect(path()).toEqual(["System Settings, then Your name, then iCloud, then Notes, then Sync this Mac"]);
    pick("iPhone");
    expect(path()).toEqual(["Settings, then Your name, then iCloud, then See All, then Notes, then Sync this iPhone"]);
  });

  it("sends a device that already has the setting on to a restart and an update", () => {
    pick("Yes, it's there");
    pick("Yes, it's on");
    expect(host.textContent).toContain("Restart that device");
    expect(host.querySelector('a[href="#update"]')).not.toBeNull();
    pick("Start again");
    expect(host.textContent).not.toContain("Restart that device");
    expect(host.querySelectorAll("fieldset")).toHaveLength(1);
  });

  it("counts each answer as blog_helper_used, and nothing else", () => {
    pick("Yes, it's there");
    pick("No, or I'm not sure");
    for (const b of host.querySelectorAll("fieldset button")) expect(b.getAttribute("data-event")).toBe("blog_helper_used");
  });
});
