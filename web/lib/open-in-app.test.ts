import { describe, expect, it } from "vitest";
import { OPEN_WAIT_MS, openEvent, openRequested, validAppLink, withoutOpen } from "./open-in-app";

describe("opening Pinto Notes from the page", () => {
  it("only tries a template's or a shared note's app link", () => {
    expect(validAppLink("ambernotes://template/habit-tracker")).toBe(true);
    expect(validAppLink("ambernotes://copy/abcdefghijklmnopqrstuvwx")).toBe(true);
    for (const bad of ["ambernotes://connect?request=x", "ambernotes://template/", "ambernotes://template/a/b", "javascript:alert(1)", "https://ambernotes.app/open/template/x", `ambernotes://template/"><x`]) {
      expect(validAppLink(bad), bad).toBe(false);
    }
  });

  it("waits about two seconds before saying it didn't open", () => expect(OPEN_WAIT_MS).toBe(2000));

  it("tries the app as the page loads only when an old link asked, and drops the ask from the address", () => {
    expect(openRequested("?open=1")).toBe(true);
    expect(openRequested("?open")).toBe(true);
    expect(openRequested("")).toBe(false);
    expect(openRequested("?category=work")).toBe(false);
    expect(withoutOpen("https://pintonotes.com/templates/habit-tracker?open=1")).toBe("/templates/habit-tracker");
    expect(withoutOpen("https://pintonotes.com/n/abc?x=2&open=1#top")).toBe("/n/abc?x=2#top");
  });

  it("names a template's attempt and its outcome, and nothing for a shared note", () => {
    const app = "ambernotes://template/habit-tracker", path = "/templates/habit-tracker";
    expect(openEvent(app, "link", path)).toEqual({ event: "use_template_clicked", properties: { path, template: "habit-tracker", source: "link" }, leaves: false });
    expect(openEvent(app, "opened", path)).toEqual({ event: "use_template_opened", properties: { path, template: "habit-tracker" }, leaves: false });
    expect(openEvent(app, "not_found", path)).toEqual({ event: "use_template_not_found", properties: { path, template: "habit-tracker" }, leaves: false });
    expect(openEvent("ambernotes://copy/abcdefghijklmnopqrstuvwx", "not_found", "/n/abcdefghijklmnopqrstuvwx")).toBeNull();
    expect(openEvent("ambernotes://connect-ai", "opened", "/")).toBeNull();
  });
});
