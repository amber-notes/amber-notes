import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Answer } from "./PostParts";

const jump = [
  { href: "#a", label: "Which to use" },
  { href: "#b", label: "What exists" },
  { href: "#c", label: "AppleScript and Python" },
];

describe("the short answer's jump links", () => {
  it("keep each dot after its link, so a row that wraps never starts a line with one", () => {
    const html = renderToStaticMarkup(<Answer jump={jump}><p>No.</p></Answer>);
    for (const { label } of jump.slice(0, -1)) expect(html).toMatch(new RegExp(`>${label}</a><span [^>]*aria-hidden="true">·</span></span>`));
    expect(html).toMatch(/>AppleScript and Python<\/a><\/span><\/p>/);
    expect(html).not.toMatch(/jumpItem[^"]*"><span/);
  });
});
