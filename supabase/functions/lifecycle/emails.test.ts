// deno test -A supabase/functions/lifecycle/emails.test.ts
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { KINDS, render } from "./emails.ts";

const UNSUB = "https://ambernotes.app/unsubscribe?u=0b6f6a5e-1d2c-4a8e-9f3b-2c1d0e9f8a7b&t=abc";
const all = KINDS.flatMap((kind) => [true, false].map((aiConnected) =>
  render(kind, { site: "https://ambernotes.app", assets: "https://ambernotes.app/email", unsubscribe: UNSUB, aiConnected })));

Deno.test("every email stays well under Gmail's 102 KB clipping limit", () => {
  for (const e of all) assert(new TextEncoder().encode(e.html).length < 60_000, `${e.kind}: ${e.html.length}`);
});

Deno.test("no em or en dashes, in the HTML or the text", () => {
  for (const e of all) for (const s of [e.subject, e.preview, e.html, e.text]) assert(!/[–—]|&mdash;|&ndash;/.test(s), e.kind);
});

Deno.test("every email has a plain-text twin with the same links and a way to stop", () => {
  for (const e of all) {
    assertStringIncludes(e.text, `Stop these emails: ${UNSUB}`);
    assertStringIncludes(e.html, `href="${UNSUB.replace(/&/g, "&amp;")}"`);
    for (const m of e.html.matchAll(/href="(https:[^"]+)"/g)) {
      const href = m[1].replace(/&amp;/g, "&");
      if (href.includes("/unsubscribe") || href.endsWith("/privacy") || href.includes("/templates/")) continue;
      assertStringIncludes(e.text, href, `${e.kind}: ${href} missing from the text`);
    }
    assert(!/undefined|null|\[object/.test(e.html + e.text), e.kind);
  }
});

Deno.test("pictures: absolute addresses, sizes set, alt text on every one", () => {
  for (const e of all) {
    for (const img of e.html.matchAll(/<img [^>]*>/g)) {
      assert(/src="https:\/\/ambernotes\.app\/email\/[a-z0-9-]+\.(jpg|png)"/.test(img[0]), img[0]);
      assert(/ alt="[^"]*"/.test(img[0]) && / width="\d+"/.test(img[0]), img[0]);
    }
  }
});

Deno.test("dark mode is declared, and the layout is tables with inline styles", () => {
  for (const e of all) {
    assertStringIncludes(e.html, '<meta name="color-scheme" content="light dark">');
    assertStringIncludes(e.html, "@media (prefers-color-scheme: dark)");
    assert(!/display:\s*(flex|grid)/.test(e.html), e.kind);
  }
});

Deno.test("the subject and preview are short enough for a phone's inbox", () => {
  for (const e of all) {
    assert(e.subject.length <= 45, e.subject);
    assert(e.preview.length <= 110, e.preview);
  }
});

Deno.test("templates link to Use template on the site, which opens the app", () => {
  const e = render("templates", { site: "https://ambernotes.app", assets: "x", unsubscribe: UNSUB, aiConnected: true });
  for (const slug of ["grocery-list", "trip-plan", "weekly-review"]) assertStringIncludes(e.html, `href="https://ambernotes.app/open/template/${slug}"`);
});

Deno.test("only an account without an AI is told how to connect one in the later emails", () => {
  const ctx = { site: "https://ambernotes.app", assets: "x", unsubscribe: UNSUB };
  for (const kind of ["templates", "undo"] as const) {
    const withAI = render(kind, { ...ctx, aiConnected: true }).text;
    const without = render(kind, { ...ctx, aiConnected: false }).text;
    assertEquals(withAI.includes("connect-chatgpt-to-your-notes"), false, kind);
    assertEquals(without.includes("connect-chatgpt-to-your-notes"), true, kind);
  }
});
