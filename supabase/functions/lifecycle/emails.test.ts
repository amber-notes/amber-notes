// deno test -A supabase/functions/lifecycle/emails.test.ts
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { askChatGPT, KINDS, render } from "./emails.ts";
import PROMPTS from "./prompts.json" with { type: "json" };

const UNSUB = "https://pintonotes.com/unsubscribe?u=0b6f6a5e-1d2c-4a8e-9f3b-2c1d0e9f8a7b&t=abc";
const ctx = { site: "https://pintonotes.com", open: "https://ambernotes.app", assets: "https://pintonotes.com/email", unsubscribe: UNSUB, sortable: false, connectTried: false };
const all = KINDS.flatMap((kind) => [ctx, { ...ctx, sortable: true, connectTried: true, variant: 1 as const }].map((c) => render(kind, c)));

Deno.test("every email stays far under Gmail's 102 KB clipping limit", () => {
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
      const href = m[1].replace(/&#39;/g, "'").replace(/&amp;/g, "&");
      if (href.includes("/unsubscribe") || href.endsWith("/privacy") || /\/templates\/[a-z-]+$/.test(href)) continue;
      assertStringIncludes(e.text, href, `${e.kind}: ${href} missing from the text`);
    }
    assert(!/undefined|null|\[object/.test(e.html + e.text), e.kind);
  }
});

Deno.test("the name is Pinto Notes, and only the links that open the app and Emil's address stay on ambernotes.app", () => {
  for (const e of all) {
    assertEquals(/Amber Notes/i.test(e.subject + e.preview + e.html + e.text), false, e.kind);
    for (const m of (e.html + e.text).matchAll(/[^\s"<>()]*ambernotes\.app[^\s"<>()]*/g)) {
      assert(m[0].startsWith("https://ambernotes.app/open/") || m[0].startsWith("mailto:emil@ambernotes.app") || m[0] === "emil@ambernotes.app", `${e.kind}: ${m[0]}`);
    }
  }
});

Deno.test("one short paragraph before the first picture or button", () => {
  for (const e of all) {
    const head = e.html.split(/<!--\[if mso\]><v:roundrect|class="shot"|class="bubble"/)[0];
    const paragraphs = (head.match(/class="ink body"/g) ?? []).length;
    assert(paragraphs <= 1, `${e.kind}: ${paragraphs} paragraphs before the button`);
    const first = head.match(/class="ink body"[^>]*>([^<]*)/)?.[1] ?? "";
    assert(first.split(/\s+/).length <= 40, `${e.kind}: ${first}`);
  }
});

Deno.test("pictures: absolute addresses, sizes set, alt text on every one", () => {
  for (const e of all) {
    for (const img of e.html.matchAll(/<img [^>]*>/g)) {
      assert(/src="https:\/\/pintonotes\.com\/email\/[a-z0-9-]+\.(jpg|png)"/.test(img[0]), img[0]);
      assert(/ alt="[^"]*"/.test(img[0]) && / width="\d+"/.test(img[0]) && / height="\d+"/.test(img[0]), img[0]);
    }
  }
});

Deno.test("built for mail apps: tables, no flex/grid/background images/web fonts, no pure white or black", () => {
  for (const e of all) {
    assertStringIncludes(e.html, '<meta name="color-scheme" content="light dark">');
    assert(!/display:\s*(flex|grid)|background-image|url\(|@import|@font-face|<svg/.test(e.html), e.kind);
    assert(!/#(fff|ffffff|000|000000)\b/i.test(e.html), `${e.kind}: pure white or black`);
    // Three style blocks, so a client that drops one keeps the others.
    assertEquals((e.html.match(/<style>/g) ?? []).length, 3);
    // Shapes are table cells: no inline-block spans standing in for boxes.
    assert(!/<span[^>]*display:inline-block;width/.test(e.html), e.kind);
  }
});

Deno.test("the subject and preview are short enough for a phone's inbox", () => {
  for (const e of all) {
    assert(e.subject.length <= 45, e.subject);
    assert(e.preview.length <= 110, e.preview);
  }
});

Deno.test("a paper-cut picture on top of every email, and real captures only inside the note", () => {
  const captures = ["connect.jpg", "undo.jpg", "app-habits.jpg", "app-budget.jpg", "share.jpg",
    "tc-meal-plan.jpg", "tc-trip-plan.jpg", "tc-weekly-review.jpg", "mark.png", "emil.jpg"];
  for (const e of all) {
    const pics = [...e.html.matchAll(/src="https:\/\/pintonotes\.com\/email\/([^"]+)"/g)].map((m) => m[1]);
    assertEquals(pics.filter((p) => p.startsWith("hero-")).length, 1, `${e.kind}: one hero`);
    assert(pics[1].startsWith("hero-"), `${e.kind}: the hero comes first, after the mark`);
    for (const p of pics.filter((p) => !p.startsWith("hero-"))) assert(captures.includes(p), `${e.kind}: ${p}`);
    assertStringIncludes(e.html, "From Emil");
  }
});

Deno.test("never a person's own numbers", () => {
  for (const e of all) assert(!/\b\d{2,}\s+notes\b/.test(e.subject + e.preview + e.text), e.kind);
});

Deno.test("the connect email: a grocery list with its capture, or sorting into folders without numbers", () => {
  const groceries = render("connect", ctx), sorting = render("connect", { ...ctx, sortable: true });
  assertStringIncludes(groceries.html, "/email/connect.jpg");
  assertStringIncludes(sorting.text, "Sort your notes into folders");
  for (const e of [groceries, sorting]) for (const s of ["Bring your notes", "https://ambernotes.app/open/connect-ai"]) assertStringIncludes(e.text, s);
});

Deno.test("a waiting connection gets the line about the last step", () => {
  const line = "typing the number the page shows";
  assertEquals(render("connect", ctx).text.includes(line), false);
  assertStringIncludes(render("connect", { ...ctx, connectTried: true }).text, line);
});

Deno.test("Try this first: each prompt opens ChatGPT filled in, and Claude through the copy page", () => {
  const e = render("try", ctx);
  for (const p of PROMPTS) {
    assertStringIncludes(e.html, `href="${askChatGPT(p.text).replace(/&/g, "&amp;").replace(/'/g, "&#39;")}"`);
    assertStringIncludes(e.html, `href="https://pintonotes.com/copy/${p.id}"`);
  }
  assert(!/border-left/.test(e.html), "no accent bar");
});

Deno.test("two subject lines per email, both short", () => {
  for (const kind of KINDS) {
    const a = render(kind, ctx), b = render(kind, { ...ctx, variant: 1 });
    assert(a.subject !== b.subject && a.preview !== b.preview, kind);
  }
});

Deno.test("templates link to Use template on the site", () => {
  const e = render("templates", ctx);
  for (const slug of ["meal-plan", "trip-plan", "weekly-review"]) {
    assertStringIncludes(e.html, `href="https://ambernotes.app/open/template/${slug}"`);
    assertStringIncludes(e.html, `/email/tc-${slug}.jpg`);
  }
  // Three across on a desktop, stacked on a phone.
  assertEquals((e.html.match(/class="tcol"/g) ?? []).length, 3);
  assertStringIncludes(e.html, ".tcol { display: block !important; width: 100% !important;");
});

Deno.test("Try this first: each prompt as a chat bubble, with Ask ChatGPT and Ask Claude under it", () => {
  const e = render("try", ctx);
  assertEquals((e.html.match(/class="bubble"/g) ?? []).length, PROMPTS.length);
  assertEquals((e.html.match(/Ask ChatGPT &rsaquo;/g) ?? []).length, PROMPTS.length);
});

Deno.test("the apps email leads to the templates gallery's Apps filter", () => {
  assertStringIncludes(render("apps", ctx).html, 'href="https://pintonotes.com/templates?category=apps"');
});

Deno.test("every button goes somewhere specific: into the app, a page section, or a store", () => {
  const want: Record<string, string> = {
    stuck: "mailto:emil@ambernotes.app", import: "https://ambernotes.app/open/import", connect: "https://ambernotes.app/open/connect-ai",
    undo: "https://ambernotes.app/open/history", apps: "https://pintonotes.com/templates?category=apps", templates: "https://pintonotes.com/templates",
    iphone: "https://apps.apple.com/", mac: "https://pintonotes.com/download", share: "https://pintonotes.com/help#share",
  };
  for (const [kind, href] of Object.entries(want)) {
    const e = render(kind as never, ctx);
    const button = e.html.match(/<v:roundrect[^>]*href="([^"]+)"/)?.[1].replace(/&amp;/g, "&") ?? "";
    assert(button.startsWith(href), `${kind}: ${button}`);
  }
});

Deno.test("nothing forces a width: pictures shrink with the column, corners are set one by one", () => {
  for (const e of all) {
    for (const img of e.html.matchAll(/<img [^>]*>/g)) {
      const w = Number(img[0].match(/ width="(\d+)"/)![1]);
      if (w > 60) assertStringIncludes(img[0], "width:100%", `${e.kind}: ${img[0].slice(0, 80)}`);
    }
    assert(!/min-width:\s*[1-9]/.test(e.html), e.kind);
    assert(!/border-radius:\s*\d+px \d+px/.test(e.html), `${e.kind}: corner shorthand`);
    assertStringIncludes(e.html, "border-bottom-left-radius:0;border-bottom-right-radius:0;padding:11px 14px");
  }
});

Deno.test("replies go to Emil", () => {
  assertStringIncludes(render("stuck", ctx).html, "mailto:emil@ambernotes.app");
});

Deno.test("the welcome: what Pinto Notes is, one step for where the person is, and a reply line", () => {
  const steps = { connect: "https://ambernotes.app/open/connect-ai", app: "https://pintonotes.com/download", try: "https://chatgpt.com/?q=" } as const;
  for (const [step, href] of Object.entries(steps)) {
    const e = render("welcome", { ...ctx, step: step as keyof typeof steps });
    assertStringIncludes(e.html, href);
    for (const s of ["iPhone and Mac", "ChatGPT and Claude", "end-to-end encrypted", "free", "Just reply, I read every email."]) assertStringIncludes(e.text, s);
    // One step only: one button, or one ask with its two places to send it.
    assertEquals((e.html.match(/class="btn"/g) ?? []).length, step === "try" ? 0 : 1, step);
  }
  assert(!render("welcome", { ...ctx, plain: true }).html.includes("/email/hero-"));
});
