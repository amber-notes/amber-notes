// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Faq from "./Faq";
import { FAQ } from "./questions";

describe("the help FAQ component", () => {
  it("labels each answer region by its question button and assigns unique ids", () => {
    const html = renderToStaticMarkup(<Faq items={FAQ} />);
    const doc = new DOMParser().parseFromString(html, "text/html");

    const rows = doc.querySelectorAll("[id]");
    const ids = Array.from(rows).map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);

    const regions = doc.querySelectorAll('[role="region"]');
    expect(regions.length).toBe(FAQ.length);

    for (const item of FAQ) {
      const row = doc.getElementById(item.id);
      expect(row).not.toBeNull();

      const button = doc.getElementById(`${item.id}-q`);
      expect(button).not.toBeNull();
      expect(button?.tagName.toLowerCase()).toBe("button");
      expect(button?.getAttribute("aria-controls")).toBe(`${item.id}-a`);

      const region = doc.getElementById(`${item.id}-a`);
      expect(region).not.toBeNull();
      expect(region?.getAttribute("role")).toBe("region");
      expect(region?.getAttribute("aria-labelledby")).toBe(`${item.id}-q`);
    }
  });
});
