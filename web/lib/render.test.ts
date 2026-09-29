import { describe, expect, it } from "vitest";
import { renderNote, summary, withoutTitle } from "./render";

const img = "3f1c2b9a-1b7e-4c3a-9f0e-2a4b8c1d7e55";
const pdf = "4a2d3c0b-2c8f-4d4b-8a1f-3b5c9d2e8f66";
const sub = "5b3e4d1c-3d9a-4e5c-9b2a-4c6d0e3f9a77";
const files = {
  [img]: { url: "https://x.supabase.co/storage/v1/object/sign/files/a/b/p.png?token=t", name: "p.png", type: "public.png", size: 2048 },
  [pdf]: { url: "https://x.supabase.co/storage/v1/object/sign/files/a/c/doc.pdf?token=t", name: "doc.pdf", type: "com.adobe.pdf", size: 1_200_000 },
};
const note = `Trip plan

Packing:

- [x] Passport
- [ ] Charger

<!-- pane-table: Day=date; Km=number -->
| Day | Km |
| --- | --- |
| 2026-09-28 | 12 |

> Bring snacks

Some <u>underlined</u> and \`code\`.

![p.png](pane-file:${img})
[doc.pdf](pane-file:${pdf})
[Hotel](pane-note:${sub})
[missing.png](pane-file:6c4f5e2d-4e0b-4f6d-8c3b-5d7e1f4a0b88)

<script>alert(1)</script>

<img src=x onerror=alert(1)>

[evil](javascript:alert(1))

[site](https://example.com)`;

describe("renderNote", () => {
  const html = renderNote(withoutTitle(note), { files, subNoteHref: (id) => `/n/slug/${id}` });

  it("drops the title line; the page shows it", () => {
    expect(withoutTitle(note).startsWith("Packing:")).toBe(true);
    expect(html).not.toContain("Trip plan");
  });
  it("checklists are read-only circles", () => {
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked[^>]*disabled|<input[^>]*checked[^>]*disabled|<input[^>]*disabled[^>]*checked/);
    expect(html).toContain("task-list-item");
  });
  it("tables render and the typed-table comment is hidden", () => {
    expect(html).toContain("<table>");
    expect(html).not.toContain("pane-table");
  });
  it("keeps quotes, underline and code", () => {
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<u>underlined</u>");
    expect(html).toContain("<code>code</code>");
  });
  it("images and files use the signed URLs; unknown files say so", () => {
    expect(html).toContain('class="embed-image"');
    expect(html).toContain(files[img].url.replace(/&/g, "&#x26;"));
    expect(html).toContain('class="file-chip"');
    expect(html).toContain("1.2 MB");
    expect(html).toContain("missing.png isn’t available");
    expect(html).not.toContain("pane-file:");
  });
  it("sub-notes link to their page when included, else show their name", () => {
    expect(html).toContain(`href="/n/slug/${sub}"`);
    const plain = renderNote(withoutTitle(note), { files, subNoteHref: () => null });
    expect(plain).toContain('class="subnote-plain"');
    expect(plain).not.toContain("/n/slug/");
  });
  it("strips scripts, handlers and javascript: links", () => {
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
  });
  it("external links open safely", () => {
    expect(html).toMatch(/href="https:\/\/example.com"[^>]*rel="noopener noreferrer nofollow ugc"|rel="noopener noreferrer nofollow ugc"[^>]*href="https:\/\/example.com"/);
  });
});

describe("summary", () => {
  it("is plain text for link previews", () => {
    expect(summary(withoutTitle(note))).toMatch(/^Packing: Passport Charger/);
    expect(summary("x".repeat(400)).length).toBe(160);
  });

  it("keeps note ids and names prefixed so they can't clobber the page's globals", () => {
    const html = renderNote('<a id="__next" name="location">x</a> <img id="document" src="https://example.com/a.png">', { files: {}, subNoteHref: () => null });
    expect(html).not.toMatch(/id="__next"/);
    expect(html).not.toMatch(/name="location"/);
    expect(html).not.toMatch(/id="document"/);
  });
});
