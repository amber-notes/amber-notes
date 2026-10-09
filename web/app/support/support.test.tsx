// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FAQ } from "../help/questions";
import Support from "./page";

describe("the support page (the App Store's support link)", () => {
  const doc = new DOMParser().parseFromString(renderToStaticMarkup(<Support />), "text/html");
  const contact = doc.getElementById("contact");
  const text = (contact?.textContent ?? "").replace(/\s+/g, " ");

  it("shows the support address as text, and as a link at the top", () => {
    expect(text).toContain("hello@pintonotes.com");
    expect(doc.querySelector('a[href="mailto:hello@pintonotes.com"]')?.textContent).toBe("hello@pintonotes.com");
    expect(doc.querySelector('a[href="#contact"]')).not.toBeNull();
  });

  it("says how to report a shared page, how to delete an account, and where the privacy policy is, without opening anything", () => {
    expect(text).toContain("Report this page");
    expect(text).toContain("Settings → Account, scroll to the bottom and choose Delete Account…");
    expect(contact?.querySelector('a[href="/privacy"]')?.textContent).toBe("Privacy policy");
    expect(contact?.querySelector('a[href="/terms"]')).not.toBeNull();
    expect(contact?.closest("[inert]")).toBeNull();
  });

  it("has the same two answers among the questions, and no dashes", () => {
    expect(FAQ.find((q) => q.id === "report-page")?.a.join(" ")).toContain("hello@pintonotes.com");
    expect(FAQ.find((q) => q.id === "delete")?.a.join(" ")).toContain("hello@pintonotes.com");
    expect(/[–—]/.test(doc.body.textContent ?? "")).toBe(false);
    expect(doc.body.textContent).not.toContain("ambernotes.app/");
  });
});
