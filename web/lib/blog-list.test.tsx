// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { isBlogList } from "./blog-list";
import BlogList from "./BlogList";
import { BlogIndex } from "./BlogIndex";
import { categories, categoryPath, pagePath } from "./posts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("the blog's lists", () => {
  it("are the index, each category and their later pages, and nothing else", () => {
    for (const base of ["/blog", ...categories().map(categoryPath)]) {
      expect(isBlogList(base), base).toBe(true);
      expect(isBlogList(pagePath(base, 2)), base).toBe(true);
    }
    for (const path of ["/", "/blog/apple-notes-mcp", "/templates", "/blog/category", "/blogs", "/blog/page/x"]) expect(isBlogList(path), path).toBe(false);
  });

  it("rise on a first visit, and hold still when one list replaces another", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    await act(() => root.render(<BlogList key="a" className="index">a</BlogList>));
    expect(host.querySelector("section")!.hasAttribute("data-still")).toBe(false);
    await act(() => root.render(<BlogList key="b" className="index">b</BlogList>));
    expect(host.querySelector("section")!.getAttribute("data-still")).toBe("true");
    await act(() => root.unmount());
    const again = createRoot(host);
    await act(() => again.render(<BlogList key="c" className="index">c</BlogList>));
    expect(host.querySelector("section")!.hasAttribute("data-still")).toBe(false);
    await act(() => again.unmount());
  });

  it("keep their title and lede as page text; the room for the longest is only in attributes", () => {
    const html = renderToStaticMarkup(<BlogIndex category="Guides" page={1} />);
    expect(html).toMatch(/<h1[^>]*>Guides<\/h1>/);
    expect(html).toMatch(/<span class="[^"]*h1[^"]*" data-a="[^"]+" data-b="[^"]+"><\/span>/);
    const text = html.replace(/<[^>]+>/g, "");
    expect(text.split("Guides to connecting ChatGPT, Claude, Gemini").length).toBe(2); // once as text; the copy is only an attribute
    expect(text).not.toContain("The Amber Notes blog");
  });
});
