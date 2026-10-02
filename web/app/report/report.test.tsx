import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/report", () => ({ sendReport: async () => {} }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));

import Report from "./[slug]/page";

const SLUG = "abcdefghijklmnopqrstuvwx";
const page = async (sent?: string, slug = SLUG) =>
  renderToStaticMarkup(await Report({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({ sent }) }));

describe("the report page", () => {
  it("is a form with a visible label on each field and one button", async () => {
    const html = await page();
    expect(html).toContain("<h1");
    expect(html).toContain("Report this page</h1>");
    expect(html).toMatch(/<label class="[^"]+" for="reason">What&#x27;s wrong\?<\/label>/);
    expect(html).toMatch(/<textarea class="[^"]+" id="reason" name="reason"[^>]*required=""[^>]*maxLength="1000"/);
    expect(html).toMatch(/<label class="[^"]+" for="contact">Your email/);
    const contact = html.match(/<input class="[^"]+" id="contact"[^>]*>/)?.[0] ?? "";
    expect(contact).toContain('name="contact"');
    expect(contact).toContain('type="email"');
    expect(contact).not.toContain("required");
    expect(html).toContain(`<input type="hidden" name="slug" value="${SLUG}"/>`);
    expect(html.match(/<button /g)).toHaveLength(1);
    expect(html).toMatch(/<button type="submit" class="[^"]+">Send report<\/button>/);
    expect(html).toContain(`href="/n/${SLUG}"`);
  });

  it("says a missing reason under the field it is about", async () => {
    const html = await page("missing_reason");
    expect(html).toMatch(/<textarea[^>]*aria-invalid="true"[^>]*aria-describedby="reason-error"/);
    expect(html).toMatch(/<p class="[^"]+" id="reason-error" role="status">Say what&#x27;s wrong\. Write a few words about the problem, then send the report\.<\/p>/);
    expect(html).toContain("<form");
  });

  it.each([
    ["too_many", "Too many reports"],
    ["error", "The report didn&#x27;t go through"],
  ])("says %s above the form and keeps the form", async (sent, title) => {
    const html = await page(sent);
    expect(html).toMatch(new RegExp(`role="status">.*<strong>${title}</strong>`));
    expect(html.indexOf(title)).toBeLessThan(html.indexOf("<form"));
    expect(html).not.toContain("aria-invalid");
  });

  it.each([
    ["received", "Thanks, we got your report"],
    ["taken_down", "Thanks, the page is down for review"],
    ["not_found", "This page isn&#x27;t shared any more"],
  ])("shows %s with no form and a way on", async (sent, title) => {
    const html = await page(sent);
    expect(html).toContain(`${title}</h1>`);
    expect(html).toContain('role="status"');
    expect(html).not.toContain("<form");
    expect(html).toMatch(/<a class="[^"]+" href="\/">Go to the home page<\/a>/);
  });

  it("keeps the privacy, terms and support links, and ignores an outcome it doesn't know", async () => {
    const html = await page("nonsense");
    for (const href of ["/privacy", "/terms", "/support"]) expect(html).toContain(`href="${href}"`);
    expect(html).toContain("<form");
  });

  it("is not found for an address that isn't a share link's", async () => {
    await expect(page(undefined, "nope")).rejects.toThrow("not found");
  });
});
