// The lifecycle emails, in words and in HTML: a short note from Emil on the cream page, with at most
// one real capture of Amber Notes (iPhone or Mac) doing what the email is about, cropped tight. No
// illustrations and no drawn window around the words. Where no capture says it clearly, no picture.
//
// Built for real mail apps (docs/Technical/lifecycle-emails.md has the client notes):
// - tables and inline styles; no flex, grid, background images, web fonts or SVG;
// - shapes that must show everywhere (checkboxes) are table cells, so Outlook for Windows draws
//   them as squares instead of dropping them;
// - three <style> blocks, so a client that drops one (Gmail drops a block it doesn't like) keeps
//   the others: phone spacing, dark mode for Apple Mail and Outlook apps, Outlook.com's dark mode;
// - no pure white or black, so Gmail's forced dark mode (it inverts colours, never images) stays soft;
// - a plain-text twin, and every HTML file far under Gmail's 102 KB clipping limit.
//
// The copy follows the house rules: Emil's voice, short, no em dashes, no invented features, and never
// a person's own data quoted back (no note counts). Nothing here knows what a person's notes say.

import type { Kind } from "./logic.ts";
import PROMPTS from "./prompts.json" with { type: "json" };

export const APP_STORE_URL = "https://apps.apple.com/app/id6817253103";

export type Context = {
  /// The site, for links (https://ambernotes.app).
  site: string;
  /// Where the pictures are: https://ambernotes.app/email in mail, a local folder for previews.
  assets: string;
  /// The page the "Stop these emails" link opens.
  unsubscribe: string;
  /// The connect email shows sorting into folders (a big library, mostly in one place) instead of a grocery list.
  sortable: boolean;
  /// An AI connection was started and is waiting (the connect email says how the last step goes).
  connectTried: boolean;
  /// Which subject line and preview (0 or 1) when two are being compared.
  variant?: 0 | 1;
};

export type Email = { kind: Kind; subject: string; preview: string; html: string; text: string };

// ---- The words ------------------------------------------------------------------------------------

/// A real capture: its file in web/public/email, its width on the page (half its pixel width), what it shows.
type Shot = { file: string; w: number; h: number; alt: string; round?: number };

/// A paragraph with [links](href). Written once, turned into HTML and into plain text.
type Block =
  | { p: string; small?: boolean }
  | { checks: { done: boolean; text: string }[] }
  | { button: { label: string; href: string } }
  | { shot: Shot }
  | { prompts: { id: string; text: string }[] }
  | { templates: Template[] };

type Template = { slug: string; title: string; tagline: string };

type Draft = {
  /// Two subject lines and previews: the first is the default, the second is compared against it.
  subject: [string, string];
  preview: [string, string];
  title: string;
  blocks: Block[];
};

const TEMPLATES: Template[] = [
  { slug: "grocery-list", title: "Grocery list", tagline: "Sorted by aisle, before you get to the shop." },
  { slug: "trip-plan", title: "Trip plan", tagline: "Days, bookings and the packing list in one place." },
  { slug: "weekly-review", title: "Weekly review", tagline: "Five questions every Sunday, written up for you." },
];

const guide = (c: Context) => `${c.site}/blog/connect-chatgpt-to-your-notes`;

/// Opens ChatGPT with the prompt in its composer. Claude's web app no longer takes a prompt in its
/// address (October 2025), so Claude goes through ambernotes.app/copy, which copies it on a tap.
export const askChatGPT = (text: string) => `https://chatgpt.com/?q=${encodeURIComponent(text)}`;
export const askClaude = (c: Pick<Context, "site">, id: string) => `${c.site}/copy/${id}`;

/// The app's setup card (Pane/Views/SetupCard.swift), with the first step done.
const SETUP: Block = { checks: [
  { done: true, text: "Bring your notes" },
  { done: false, text: "Connect your AI" },
  { done: false, text: "Try it" },
] };

function draft(kind: Kind, c: Context): Draft {
  switch (kind) {
    case "stuck":
      return {
        subject: ["Did something go wrong after signing in?", "Your Amber Notes account is still empty"],
        preview: ["Your Amber Notes account has no notes yet. If the app got in your way, I'd like to know.",
          "No notes have arrived yet. If something got stuck after signing in, tell me."],
        title: "Did something get stuck?",
        blocks: [
          { p: "Hi, I'm Emil, and I make Amber Notes. You made an account, but no notes have arrived yet. If something after signing in was confusing or got stuck, tell me and I'll help you get going." },
          { button: { label: "Reply to Emil", href: "mailto:emil@ambernotes.app?subject=Stuck%20after%20signing%20in" } },
          { p: "Notes in Apple Notes? On the Mac, choose File, then Import from Apple Notes.", small: true },
        ],
      };
    case "import":
      return {
        subject: ["Bring your Apple Notes over", "Your Apple Notes, in Amber Notes"],
        preview: ["One menu on the Mac brings your notes across with their folders. Apple Notes stays as it is.",
          "Choose File, then Import from Apple Notes. Folders come along, and Apple Notes stays as it is."],
        title: "Bring your Apple Notes over",
        blocks: [
          { p: "Hi, Emil here. On your Mac, choose File, then Import from Apple Notes. Your notes come over with their folders, and Apple Notes stays exactly as it is." },
          { shot: { file: "import.jpg", w: 330, h: 278, alt: "Amber Notes on a Mac: the Import from Apple Notes window, with notes ticked to bring over" } },
          { button: { label: "How importing works", href: `${c.site}/blog/move-from-apple-notes` } },
          { p: "You can bring all of them, or pick some.", small: true },
        ],
      };
    case "connect": {
      const last = c.connectTried
        ? "Started connecting? Finish by typing the number the page shows into Amber Notes on your iPhone or Mac."
        : "In the app: Settings, then Connect an AI. You approve it on your iPhone or Mac.";
      return c.sortable
        ? {
          subject: ["Let ChatGPT sort your notes into folders", "A tidier Amber Notes in one ask"],
          preview: ["Connect ChatGPT or Claude and ask it to sort your notes. It makes the folders and moves each note.",
            "Ask ChatGPT or Claude to sort your notes into folders, and it does the moving."],
          title: "Sort your notes into folders",
          blocks: [
            { p: "Hi, Emil here. Connect ChatGPT or Claude, then ask it to sort your notes into folders. It reads them, makes the folders and moves each note, and you can ask it to suggest the folders first." },
            SETUP,
            { button: { label: "Connect in a few minutes", href: guide(c) } },
            { p: last, small: true },
          ],
        }
        : {
          subject: ["Your grocery list, kept by ChatGPT", "Let ChatGPT or Claude into your notes"],
          preview: ["Tell ChatGPT what you need, and the list in Amber Notes changes. Every change is marked, with Undo.",
            "Connect ChatGPT or Claude, then just ask. The change lands in your note, marked, with Undo."],
          title: "Let your AI keep the grocery list",
          blocks: [
            { p: "Hi, Emil here. Connect ChatGPT or Claude, then say \"Add what I need for paella on Sunday.\" The lines appear in your note, marked, with Undo." },
            { shot: { file: "connect.jpg", w: 350, h: 337, alt: "A Groceries note on an iPhone with five new lines marked in amber, and the bar ChatGPT changed 5 lines, Undo" } },
            SETUP,
            { button: { label: "Connect in a few minutes", href: guide(c) } },
            { p: last, small: true },
          ],
        };
    }
    case "try":
      return {
        subject: ["Three things to ask your AI first", "Your AI is connected. Try one of these"],
        preview: ["Tap one and it opens in ChatGPT or Claude, ready to send.",
          "Three first asks for ChatGPT or Claude, one tap each."],
        title: "Try this first",
        blocks: [
          { p: "Your AI is connected. Tap one of these, and it opens in ChatGPT or Claude ready to send." },
          { prompts: PROMPTS },
          { p: "In ChatGPT, add Amber Notes from the tools menu in a new chat first.", small: true },
        ],
      };
    case "undo":
      return {
        subject: ["Every AI edit comes with Undo", "You can always put a note back"],
        preview: ["Your AI made its first change. Here's how to see it, and how to take any change back.",
          "Every change your AI makes is marked, with Undo and the earlier versions kept."],
        title: "You can always put it back",
        blocks: [
          { p: "Your AI made its first change. When it edits a note you have open, this bar appears, and Undo puts the note back." },
          { shot: { file: "receipt.png", w: 295, h: 78, alt: "ChatGPT changed 5 lines, Undo", round: 0 } },
          { p: "Older changes are in each note's version history: on a note, choose More (•••), then Show Version History." },
          { shot: { file: "undo.jpg", w: 260, h: 280, alt: "Version History on a Mac: the current version, and the one ChatGPT made at 4:35" } },
          { p: "Versions an AI made are kept for 90 days.", small: true },
        ],
      };
    case "apps":
      // Behind APPS_LIVE. Check the words against the shipped feature before turning it on.
      return {
        subject: ["Your notes can be apps", "A habit tracker, made in a note"],
        preview: ["A note in Amber Notes can be a small app now, like a habit tracker or a budget.",
          "Ask your AI to turn a note into an app, or start from a template."],
        title: "Your notes can be apps",
        blocks: [
          { p: "Hi, Emil here. A note can hold a small app now. Here are two: a habit tracker you tick off every day, and a budget that adds up as you go." },
          { shot: { file: "app-habits.jpg", w: 300, h: 214, alt: "A habit tracker app in an Amber Notes note: four of four done today" } },
          { shot: { file: "app-budget.jpg", w: 300, h: 219, alt: "A budget app in an Amber Notes note: October budget with spending by category" } },
          { button: { label: "Use the habit tracker", href: `${c.site}/open/template/habit-tracker` } },
        ],
      };
    case "templates":
      return {
        subject: ["Three notes your AI can keep for you", "A grocery list that sorts itself"],
        preview: ["A grocery list, a trip plan and a weekly review, each with the instructions to give ChatGPT or Claude.",
          "Three templates: add the note, give your AI the instructions once, and it keeps the note up to date."],
        title: "Three templates to try",
        blocks: [
          { p: "A template is a note plus instructions for your AI. Add the note, paste the instructions into ChatGPT or Claude once, and it keeps the note up to date." },
          { templates: TEMPLATES },
          { button: { label: "See all templates", href: `${c.site}/templates` } },
        ],
      };
    case "iphone":
      // Behind APP_STORE_LIVE.
      return {
        subject: ["Amber Notes is on iPhone", "Your notes, on your iPhone"],
        preview: ["Sign in with the same account and your notes are there, with your AI's changes.",
          "Amber Notes is in the App Store. Your notes are waiting there."],
        title: "Your notes, on your iPhone",
        blocks: [
          { p: "Hi, Emil here. Amber Notes is in the App Store. Sign in with the same account, and your notes are there, with everything your AI changed." },
          { shot: { file: "iphone.jpg", w: 300, h: 323, alt: "Amber Notes on an iPhone: a Groceries note with lines ChatGPT added", round: 24 } },
          { button: { label: "Get it on the App Store", href: APP_STORE_URL } },
          { p: "Your key comes along through iCloud Keychain, so your notes open right away.", small: true },
        ],
      };
    case "mac":
      return {
        subject: ["Amber Notes on your Mac", "Your notes, on your Mac too"],
        preview: ["The Mac app is free. Sign in with the same account, and it can bring your Apple Notes over too.",
          "Amber Notes for Mac is a free download. Your notes are already there."],
        title: "Amber Notes on your Mac",
        blocks: [
          { p: "Hi, Emil here. Amber Notes is on the Mac too, and it's free. Sign in with the same account, and on the Mac it can also bring your Apple Notes over." },
          { shot: { file: "mac.jpg", w: 350, h: 320, alt: "Amber Notes on a Mac: the folders and the note list" } },
          { button: { label: "Download for Mac", href: `${c.site}/download` } },
          { p: "It needs macOS 26 or later.", small: true },
        ],
      };
    case "share":
      // Behind SHARING_LIVE. Check the words against the shipped feature before turning it on.
      return {
        subject: ["Write a note together", "Share a note, and see each other type"],
        preview: ["Share a note with someone, and you both see each other's cursor as you write.",
          "A trip plan for two, a list for the house: share it and write in it together."],
        title: "Write a note together",
        blocks: [
          { p: "Hi, Emil here. You can share a note with someone now and write in it together. You see their cursor as they type, and they see yours." },
          { shot: { file: "share.jpg", w: 352, h: 350, alt: "A shared note on an iPhone, with the other person's avatar at the top and their cursor and name where they type" } },
          { button: { label: "How sharing works", href: `${c.site}/help` } },
        ],
      };
  }
}

// ---- Plain text -----------------------------------------------------------------------------------

const LINK = /\[([^\]]+)\]\(([^)]+)\)/g;
const plain = (s: string) => s.replace(LINK, "$1 ($2)");

function textOf(d: Draft, c: Context): string {
  const out: string[] = [d.title, ""];
  for (const b of d.blocks) {
    if ("p" in b) out.push(plain(b.p), "");
    else if ("checks" in b) out.push(...b.checks.map((x) => `${x.done ? "[x]" : "[ ]"} ${x.text}`), "");
    else if ("button" in b) out.push(`${b.button.label}: ${b.button.href.replace(/^mailto:([^?]+).*/, "$1")}`, "");
    else if ("prompts" in b) for (const x of b.prompts) out.push(`"${x.text}"`, `Ask ChatGPT: ${askChatGPT(x.text)}`, `Ask Claude: ${askClaude(c, x.id)}`, "");
    else if ("templates" in b) for (const t of b.templates) out.push(`${t.title}: ${t.tagline}`, `Use template: ${c.site}/open/template/${t.slug}`, "");
  }
  out.push("Emil", "I make Amber Notes. Just reply to reach me.", "", "--",
    "You're getting this because you made an Amber Notes account. Each of these emails stops once you've done what it's about.",
    `Stop these emails: ${c.unsubscribe}`,
    `Amber Notes, made by Emil Wagman in Sweden. Privacy: ${c.site}/privacy`);
  return out.join("\n") + "\n";
}

// ---- HTML -----------------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const SANS = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const DISPLAY = "-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// The site's tokens (web/app/site.css), with white and near-black kept off the extremes so forced
// inversion stays soft.
const L = { ground: "#fff4e6", page: "#fffdf9", edge: "#efe6d8", text: "#1d1d1f", secondary: "#6e6e73", circle: "#aeaeb2",
  accent: "#e39410", accentText: "#a85700", muted: "#74604c", link: "#a85700", cta: "#2a1d10", ctaInk: "#fff4e6",
  composer: "#f2f1ef", composerEdge: "#e6e3de", shotEdge: "#e8e2d8" };

function inline(s: string, linkClass: string, color: string): string {
  let out = "", last = 0;
  for (const m of s.matchAll(LINK)) {
    out += esc(s.slice(last, m.index));
    out += `<a class="${linkClass}" href="${esc(m[2])}" style="color:${color};text-decoration:underline;">${esc(m[1])}</a>`;
    last = m.index! + m[0].length;
  }
  return out + esc(s.slice(last));
}

const table = (attrs = "") => `<table role="presentation" cellpadding="0" cellspacing="0" border="0"${attrs}>`;

/// A checkbox as the app draws it, built from a table cell so Outlook for Windows shows it too.
function box(done: boolean, size = 20): string {
  return done
    ? `${table()}<tr><td class="tick" width="${size}" height="${size}" align="center" valign="middle" bgcolor="${L.accent}" style="width:${size}px;height:${size}px;border-radius:${size / 2}px;background:${L.accent};color:${L.page};font-family:Arial,sans-serif;font-size:${Math.round(size * 0.6)}px;line-height:${size}px;font-weight:700;">&#10003;</td></tr></table>`
    : `${table()}<tr><td class="ring" width="${size - 3}" height="${size - 3}" style="width:${size - 3}px;height:${size - 3}px;border:1.5px solid ${L.circle};border-radius:${size / 2}px;font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
}

/// A capture, centred, at most its own width, with a hairline so a light screenshot holds its edge
/// on a dark page.
function shotHTML(c: Context, x: Shot): string {
  const r = x.round ?? 12;
  const edge = r === 0 ? "" : `border:1px solid ${L.shotEdge};border-radius:${r}px;`;
  return `${table(' width="100%" style="margin:2px 0 20px;"')}<tr><td align="center">
<img class="shot" src="${c.assets}/${x.file}" width="${x.w}" height="${x.h}" alt="${esc(x.alt)}" style="display:block;width:100%;max-width:${x.w}px;height:auto;${edge}color:${L.secondary};font-family:${SANS};font-size:13px;">
</td></tr></table>`;
}

function blockHTML(b: Block, c: Context): string {
  if ("p" in b) {
    return b.small
      ? `<p class="sec small" style="margin:0 0 16px;font-size:14px;line-height:1.5;mso-line-height-rule:exactly;color:${L.secondary};">${inline(b.p, "lnk", L.accentText)}</p>`
      : `<p class="ink body" style="margin:0 0 18px;font-size:17px;line-height:1.5;mso-line-height-rule:exactly;color:${L.text};">${inline(b.p, "lnk", L.accentText)}</p>`;
  }
  if ("checks" in b) {
    const rows = b.checks.map((x) =>
      `<tr><td class="crow" width="32" valign="top" style="width:32px;padding:2px 0 10px;">${box(x.done)}</td><td class="${x.done ? "sec" : "ink"} crow" style="padding:0 0 10px;font-size:17px;line-height:1.45;mso-line-height-rule:exactly;color:${x.done ? L.secondary : L.text};">${esc(x.text)}</td></tr>`).join("");
    return `${table(' style="margin:0 0 12px;"')}${rows}</table>`;
  }
  if ("button" in b) {
    const href = esc(b.button.href), label = esc(b.button.label);
    return `${table(' style="margin:6px 0 20px;"')}<tr><td>
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:46px;v-text-anchor:middle;width:260px;" arcsize="28%" stroke="f" fillcolor="${L.cta}"><w:anchorlock/><center style="color:${L.ctaInk};font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${label}</center></v:roundrect><![endif]-->
<!--[if !mso]><!-->${table()}<tr><td class="btn" bgcolor="${L.cta}" style="background:${L.cta};border-radius:13px;"><a href="${href}" target="_blank" style="display:inline-block;padding:13px 22px;font-family:${SANS};font-size:16px;font-weight:600;line-height:20px;color:${L.ctaInk};text-decoration:none;border-radius:13px;"><span class="btn-ink" style="color:${L.ctaInk};">${label}</span></a></td></tr></table><!--<![endif]-->
</td></tr></table>`;
  }
  if ("shot" in b) return shotHTML(c, b.shot);
  if ("prompts" in b) {
    // Each prompt as you'd type it: a plain composer row, then where to send it.
    return b.prompts.map((x) => `${table(' width="100%" style="margin:0 0 16px;"')}
<tr><td class="composer" bgcolor="${L.composer}" style="background:${L.composer};border:1px solid ${L.composerEdge};border-radius:20px;padding:12px 16px;font-family:${SANS};font-size:16px;line-height:1.45;mso-line-height-rule:exactly;color:${L.text};"><span class="ink" style="color:${L.text};">${esc(x.text)}</span></td></tr>
<tr><td style="padding:8px 4px 0;font-family:${SANS};font-size:15px;line-height:20px;font-weight:600;">
<a href="${esc(askChatGPT(x.text))}" style="color:${L.accentText};text-decoration:none;"><span class="lnk" style="color:${L.accentText};">Ask ChatGPT</span></a><span class="sec" style="color:${L.secondary};">&nbsp;&nbsp;·&nbsp;&nbsp;</span><a href="${esc(askClaude(c, x.id))}" style="color:${L.accentText};text-decoration:none;"><span class="lnk" style="color:${L.accentText};">Ask Claude</span></a>
</td></tr></table>`).join("\n") + `<div style="height:4px;line-height:4px;font-size:0;">&nbsp;</div>`;
  }
  // Templates: the top of each template's note as the site shows it on a phone (its title and what
  // it's for, readable at phone width, so nothing repeats them), then the link that adds it.
  return b.templates.map((t) => {
    const use = `${c.site}/open/template/${t.slug}`;
    return `${table(' width="100%" style="margin:0 0 22px;"')}<tr><td>
<a href="${c.site}/templates/${t.slug}"><img class="shot" src="${c.assets}/t-${t.slug}.jpg" width="330" height="155" alt="The ${esc(t.title)} template note: ${esc(t.tagline)}" style="display:block;width:100%;max-width:330px;height:auto;border:1px solid ${L.shotEdge};border-radius:12px;color:${L.secondary};font-family:${SANS};font-size:13px;"></a>
<a href="${use}" style="display:inline-block;margin-top:10px;font-family:${SANS};font-size:15px;font-weight:600;line-height:20px;color:${L.accentText};text-decoration:none;"><span class="lnk" style="color:${L.accentText};">Use the ${esc(t.title.toLowerCase())} template &rarr;</span></a>
</td></tr></table>`;
  }).join("\n");
}

function htmlOf(d: Draft, c: Context): string {
  const a = c.assets;
  const v = c.variant ?? 0;
  const body = d.blocks.map((b) => blockHTML(b, c)).join("\n");
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(d.subject[v])}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  @media (max-width: 480px) {
    .outer { padding: 16px 8px 32px !important; }
    .pad { padding-left: 24px !important; padding-right: 24px !important; }
    .padtop { padding-top: 28px !important; }
    .h1 { font-size: 25px !important; line-height: 1.2 !important; margin-bottom: 16px !important; }
    .body { line-height: 1.62 !important; margin-bottom: 22px !important; }
    .small { line-height: 1.6 !important; }
    .crow { padding-bottom: 16px !important; }
  }
</style>
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .ground { background: #2e180a !important; }
    .card { background: #1e1e1e !important; border-color: #3a2a1c !important; }
    .ink { color: #f5f5f7 !important; }
    .sec { color: #a1a1a6 !important; }
    .muted { color: #d9bf9f !important; }
    .lnk { color: #f5ad33 !important; }
    .foot-lnk { color: #f7b865 !important; }
    .ring { border-color: #6e6e73 !important; }
    .tick { background: #f5ad33 !important; color: #1e1e1e !important; }
    .btn { background: #fbeedd !important; }
    .btn-ink { color: #2e180a !important; }
    .rule { border-color: #333333 !important; }
    .composer { background: #2c2c2e !important; border-color: #3a3a3c !important; }
    .shot { border-color: #3a3a3c !important; }
  }
</style>
<style>
  [data-ogsc] .ink { color: #f5f5f7 !important; }
  [data-ogsc] .sec { color: #a1a1a6 !important; }
  [data-ogsc] .muted { color: #d9bf9f !important; }
  [data-ogsc] .lnk { color: #f5ad33 !important; }
  [data-ogsb] .ground { background: #2e180a !important; }
  [data-ogsb] .card { background: #1e1e1e !important; }
  [data-ogsb] .composer { background: #2c2c2e !important; }
</style>
</head>
<body class="ground" style="margin:0;padding:0;background:${L.ground};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(d.preview[v])}${"&#847;&zwnj;&nbsp;".repeat(30)}</div>
${table(` class="ground" width="100%" bgcolor="${L.ground}" style="background:${L.ground};"`)}
<tr><td class="outer" align="center" style="padding:28px 12px 40px;">
<!--[if mso]><table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
${table(' width="100%" style="max-width:520px;"')}
  <tr><td style="padding:0 4px 18px;">
    ${table()}<tr>
      <td style="padding-right:10px;"><img src="${a}/mark.png" width="28" height="28" alt="" style="display:block;border:0;border-radius:7px;"></td>
      <td class="ink" style="font-family:${DISPLAY};font-size:18px;font-weight:700;color:#2a1d10;">Amber Notes</td>
    </tr></table>
  </td></tr>
  <tr><td class="card" bgcolor="${L.page}" style="background:${L.page};border:1px solid ${L.edge};border-radius:18px;">
    ${table(' width="100%"')}
      <tr><td class="pad padtop" style="padding:30px 32px 6px;font-family:${SANS};">
        <h1 class="ink h1" style="margin:0 0 14px;font-family:${DISPLAY};font-size:27px;line-height:1.2;font-weight:700;color:${L.text};">${esc(d.title)}</h1>
${body}
      </td></tr>
      <tr><td class="pad" style="padding:0 32px 26px;font-family:${SANS};">
        ${table(' width="100%"')}<tr><td class="rule" style="border-top:1px solid ${L.edge};padding-top:18px;">
          ${table()}<tr>
            <td valign="middle" style="padding-right:12px;"><img src="${a}/emil.jpg" width="44" height="44" alt="" style="display:block;width:44px;height:44px;border:0;border-radius:22px;"></td>
            <td valign="middle" style="font-family:${SANS};">
              <p class="ink" style="margin:0;font-size:16px;line-height:1.35;font-weight:600;color:${L.text};">Emil</p>
              <p class="sec" style="margin:0;font-size:14px;line-height:1.4;color:${L.secondary};">I make Amber Notes. Just reply to reach me.</p>
            </td>
          </tr></table>
        </td></tr></table>
      </td></tr>
    </table>
  </td></tr>
  <tr><td class="muted" style="padding:20px 8px 0;font-family:${SANS};font-size:13px;line-height:1.55;color:${L.muted};">
    You're getting this because you made an Amber Notes account. Each of these emails stops once you've done what it's about. <a class="foot-lnk" href="${esc(c.unsubscribe)}" style="color:${L.link};">Stop these emails</a>.<br><br>
    Amber Notes, made by Emil Wagman in Sweden. <a class="foot-lnk" href="${c.site}/privacy" style="color:${L.link};">Privacy</a>
  </td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
`;
}

export function render(kind: Kind, c: Context): Email {
  const d = draft(kind, c);
  const v = c.variant ?? 0;
  return { kind, subject: d.subject[v], preview: d.preview[v], html: htmlOf(d, c), text: textOf(d, c) };
}

export const KINDS: Kind[] = ["stuck", "import", "connect", "try", "undo", "apps", "templates", "iphone", "mac", "share"];
