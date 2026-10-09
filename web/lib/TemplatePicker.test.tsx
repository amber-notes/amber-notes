// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APPLE_NOTES_TEMPLATES } from "./apple-notes-templates";
import { blocksOf, TemplatePicker } from "./TemplatePicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEMPLATES = [
  { title: "Packing list", text: "# Packing list\n\n## Documents\n- [ ] Passport or ID\n- [ ] Tickets" },
  { title: "Meeting notes", text: "# Meeting notes\nDate:\n\n## Agenda\n- First topic\n\n## Action items\n- [ ] Who: what" },
];

let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); act(() => root.render(<TemplatePicker templates={TEMPLATES} legend="Pick a template" />)); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const panels = () => [...host.firstElementChild!.children].filter((el): el is HTMLElement => el.tagName === "DIV");
const shown = () => panels().filter((p) => p.hidden).length;
const visibleTitle = () => panels().find((p) => !p.hidden)?.querySelector("p")?.textContent;

describe("the template picker", () => {
  it("keeps every template in the page and shows the first", () => {
    expect(host.textContent).toContain("Passport or ID");
    expect(host.textContent).toContain("Who: what");
    expect(shown()).toBe(1);
    expect(visibleTitle()).toBe("Packing list");
  });

  it("shows the template that was picked, and counts the pick", () => {
    const b = [...host.querySelectorAll("button")].find((x) => x.textContent === "Meeting notes")!;
    expect(b.getAttribute("data-event")).toBe("blog_helper_used");
    act(() => b.click());
    expect(b.getAttribute("aria-pressed")).toBe("true");
    expect(visibleTitle()).toBe("Meeting notes");
  });
});

describe("drawing a template the way Notes pastes it", () => {
  it("turns # into a title, ## into headings, - [ ] into a checklist and - into dashes", () => {
    expect(blocksOf(TEMPLATES[1].text)).toEqual([
      { kind: "title", text: "Meeting notes" },
      { kind: "line", text: "Date:" },
      { kind: "heading", text: "Agenda" },
      { kind: "dash", items: ["First topic"] },
      { kind: "heading", text: "Action items" },
      { kind: "tick", items: ["Who: what"] },
    ]);
  });
});

describe("the Apple Notes templates post", () => {
  // In Notes on macOS 27, Paste as Markdown turns an empty "- [ ]" into the text [ ] and drops an empty "- ".
  it.each(APPLE_NOTES_TEMPLATES.map((t) => [t.title, t.text]))("%s has words in every list item", (_, text) => {
    for (const line of text.split("\n")) if (line.startsWith("- ")) expect(line.replace(/^- (\[ \] )?/, "").trim(), line).not.toBe("");
  });
});
