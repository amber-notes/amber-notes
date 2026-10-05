// The lifecycle emails, in words and in HTML. Each one is a note from Emil, drawn the way the site
// draws notes (the 404 page, the template pages): an Amber Notes window on the cream page, under a
// paper-cut picture from the template covers. Light and dark (Apple Mail, Outlook for Mac and iOS
// read the media query; Outlook.com uses [data-ogsc]/[data-ogsb]; Gmail's apps invert by
// themselves). Tables and inline styles only, images with alt text and the words still complete
// without them, a plain-text twin, and every HTML file well under Gmail's 102 KB clipping limit.
//
// The copy follows the house rules: Emil's voice, short, no em dashes, no invented features.
// Nothing here knows anything about a person's notes: the only input is whether an AI is connected.

import type { Kind } from "./logic.ts";

export const CLAUDE_DIRECTORY_URL = "https://claude.ai/directory/amber-notes";

export type Context = {
  /// The site, for links (https://ambernotes.app).
  site: string;
  /// Where the pictures are: https://ambernotes.app/email in mail, a local folder for previews.
  assets: string;
  /// The page the "Stop these emails" link opens.
  unsubscribe: string;
  /// Whether the account has connected an AI (the templates and Undo emails say a little more if not).
  aiConnected: boolean;
};

export type Email = { kind: Kind; subject: string; preview: string; html: string; text: string };

// ---- The words ------------------------------------------------------------------------------------

/// A paragraph with [links](href). Written once, turned into HTML and into plain text.
type Block =
  | { p: string; small?: boolean }
  | { checks: { done: boolean; text: string }[] }
  | { button: { label: string; href: string } }
  | { receipt: { ai: string; text: string } }
  | { templates: Template[] };

type Template = { slug: string; title: string; tagline: string; ground: string; light: boolean };

type Draft = {
  subject: string;
  preview: string;
  /// The note's title, and the window's folder.
  title: string;
  folder: string;
  /// The paper-cut picture at the top, from the template covers, and what it shows. The templates
  /// email has none: its three template cards are its pictures.
  art?: { file: string; ground: string; alt: string };
  blocks: Block[];
};

const TEMPLATES: Template[] = [
  { slug: "grocery-list", title: "Grocery list", tagline: "Sorted by aisle, before you get to the shop.", ground: "#c83829", light: true },
  { slug: "trip-plan", title: "Trip plan", tagline: "Days, bookings and the packing list in one place.", ground: "#2e5339", light: true },
  { slug: "weekly-review", title: "Weekly review", tagline: "Five questions every Sunday, written up for you.", ground: "#e5837f", light: false },
];

const guide = (c: Context) => `${c.site}/blog/connect-chatgpt-to-your-notes`;

function draft(kind: Kind, c: Context): Draft {
  switch (kind) {
    case "connect":
      return {
        subject: "Let ChatGPT or Claude into your notes",
        preview: "It takes a few minutes. You approve it on your own iPhone or Mac, and every change it makes has Undo.",
        title: "Connect your AI",
        folder: "Notes",
        art: { file: "connect.jpg", ground: "#2e346d", alt: "Two paper-cut armchairs with a mug each, ready for a chat" },
        blocks: [
          { p: "Hi, Emil here. I make Amber Notes. Your first notes are in, which leaves the one step I built the whole app for." },
          { checks: [
            { done: true, text: "Make an account" },
            { done: true, text: "Add your first notes" },
            { done: false, text: "Connect ChatGPT or Claude" },
          ] },
          { p: "Once it's connected, you can type \"Add oat milk to my groceries\" in ChatGPT and the line appears in your note a moment later. You approve each AI on your own iPhone or Mac first, and you can give it Read Only if you'd rather it just looked." },
          { button: { label: "Show me how", href: guide(c) } },
          { p: `In the app, it's Settings, then Connect an AI. Using Claude? [Add Amber Notes from Claude's directory](${CLAUDE_DIRECTORY_URL}) in one step.`, small: true },
        ],
      };
    case "templates":
      return {
        subject: "Three notes your AI can keep for you",
        preview: "A grocery list, a trip plan and a weekly review, each with the instructions to give ChatGPT or Claude.",
        title: "Three templates to try",
        folder: "Notes",
        blocks: [
          { p: "A template is a note plus a few lines of instructions for your AI. Use template adds the note to Amber Notes. You paste the instructions into ChatGPT or Claude once, and from then on it keeps the note up to date for you." },
          { templates: TEMPLATES },
          { p: `Each template's page has its instructions, with a Copy button. [See all the templates](${c.site}/templates).` },
          ...(c.aiConnected ? [] : [{ p: `Templates need ChatGPT or Claude connected to Amber Notes. In the app, that's Settings, then Connect an AI, and [this guide](${guide(c)}) walks through it.`, small: true }]),
          { p: "If you make a template of your own, reply and show me. I'd love to see it." },
        ],
      };
    case "undo":
      return {
        subject: "Every AI edit comes with Undo",
        preview: "When ChatGPT or Claude changes a note, you see what changed and can put it back.",
        title: "You can always put it back",
        folder: "Notes",
        art: { file: "undo.jpg", ground: "#754024", alt: "A paper-cut signpost where a path splits in two, with a compass in the grass" },
        blocks: [
          { p: "Letting an AI change your notes takes some trust. So I built Amber Notes to show you every change it makes, and to let you take any of them back." },
          { receipt: { ai: "Claude", text: "Claude changed 3 lines" } },
          { p: c.aiConnected
            ? "When your AI edits the note you have open, this appears at the bottom of it. Undo puts the note back the way it was. A note it changed while you were away is marked \"Edited by Claude\" (or ChatGPT) in the list until you open it."
            : "Once you connect ChatGPT or Claude, this appears at the bottom of the note you have open whenever it edits that note. Undo puts the note back the way it was. A note it changed while you were away is marked \"Edited by Claude\" (or ChatGPT) in the list until you open it." },
          { p: "Older changes are in the note's version history. Try it on any note:" },
          { checks: [
            { done: false, text: "Open a note" },
            { done: false, text: "Choose More (•••), then Show Version History" },
          ] },
          { p: "Every earlier version is there by day, and you can bring any of them back. Versions that an AI made are kept for 90 days." },
          ...(c.aiConnected ? [] : [{ button: { label: "Connect your AI", href: guide(c) } } as Block]),
        ],
      };
    case "stuck":
      return {
        subject: "Did something go wrong after signing in?",
        preview: "Your Amber Notes account has no notes yet. If the app got in your way, I'd like to know.",
        title: "Did something get stuck?",
        folder: "Notes",
        art: { file: "stuck.jpg", ground: "#e9a82a", alt: "A paper-cut ladybird on a leaf, next to a magnifying glass and a toolbox" },
        blocks: [
          { p: "Hi, I'm Emil, and I make Amber Notes. You made an account recently, but no notes have arrived in it yet." },
          { p: "Maybe that's on purpose. But if a screen after signing in was confusing, or the app got stuck, I'd really like to hear about it, because then it's probably happening to other people too." },
          { p: "Reply with one line or a screenshot. I read every reply myself, and I'll help you get going." },
          { button: { label: "Reply to Emil", href: "mailto:hello@ambernotes.app?subject=Stuck%20after%20signing%20in" } },
          { p: "Have notes in Apple Notes? On the Mac, choose File, then Import from Apple Notes. It brings them all over with their folders, and Apple Notes stays as it is.", small: true },
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
    else if ("receipt" in b) out.push(`  ${b.receipt.text}  |  Undo`, "");
    else if ("templates" in b) {
      for (const t of b.templates) out.push(`${t.title}: ${t.tagline}`, `Use template: ${c.site}/open/template/${t.slug}`, "");
    }
  }
  out.push("Emil", "I make Amber Notes. Replies come straight to me.", "", "--",
    "You're getting this because you made an Amber Notes account. I send new accounts a few short emails like this one, and each one stops once you've done what it's about.",
    `Stop these emails: ${c.unsubscribe}`,
    `Amber Notes, made by Emil Wagman in Sweden. Privacy: ${c.site}/privacy`);
  return out.join("\n") + "\n";
}

// ---- HTML -----------------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const SANS = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const DISPLAY = "-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// The site's tokens (web/app/site.css for the page, web/app/globals.css for the note).
const L = { ground: "#fff4e6", page: "#ffffff", chrome: "#f6f5f3", edge: "#ebe6df", text: "#1d1d1f", secondary: "#6e6e73", circle: "#aeaeb2",
  accent: "#e39410", accentText: "#b86e00", muted: "#74604c", link: "#a85700", cta: "#2a1d10", ctaInk: "#fff4e6", soft: "#fbe8c8", softInk: "#5c3400" };

function inline(s: string, linkClass: string, color: string): string {
  let out = "", last = 0;
  for (const m of s.matchAll(LINK)) {
    out += esc(s.slice(last, m.index));
    out += `<a class="${linkClass}" href="${esc(m[2])}" style="color:${color};text-decoration:underline;text-decoration-color:${L.accent};">${esc(m[1])}</a>`;
    last = m.index! + m[0].length;
  }
  return out + esc(s.slice(last));
}

function blockHTML(b: Block, c: Context): string {
  if ("p" in b) {
    return b.small
      ? `<p class="sec" style="margin:0 0 16px;font-size:14px;line-height:1.5;color:${L.secondary};">${inline(b.p, "lnk", L.accentText)}</p>`
      : `<p class="ink" style="margin:0 0 16px;font-size:17px;line-height:1.5;color:${L.text};">${inline(b.p, "lnk", L.accentText)}</p>`;
  }
  if ("checks" in b) {
    const rows = b.checks.map((x) => {
      const circle = x.done
        ? `<span class="tick" style="display:inline-block;width:20px;height:20px;border-radius:10px;background:${L.accent};color:#ffffff;font-size:13px;line-height:20px;text-align:center;font-weight:700;">&#10003;</span>`
        : `<span class="ring" style="display:inline-block;width:17px;height:17px;border-radius:10px;border:1.5px solid ${L.circle};"></span>`;
      return `<tr><td width="30" valign="top" style="width:30px;padding:3px 0 9px;">${circle}</td><td class="${x.done ? "sec" : "ink"}" style="padding:0 0 9px;font-size:17px;line-height:1.5;color:${x.done ? L.secondary : L.text};">${esc(x.text)}</td></tr>`;
    }).join("");
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:2px 0 12px;">${rows}</table>`;
  }
  if ("button" in b) {
    const href = esc(b.button.href), label = esc(b.button.label);
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 22px;"><tr><td>
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:46px;v-text-anchor:middle;width:220px;" arcsize="28%" stroke="f" fillcolor="${L.cta}"><w:anchorlock/><center style="color:${L.ctaInk};font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${label}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="btn" bgcolor="${L.cta}" style="background:${L.cta};border-radius:13px;"><a href="${href}" target="_blank" style="display:inline-block;padding:13px 22px;font-family:${SANS};font-size:16px;font-weight:600;line-height:20px;color:${L.ctaInk};text-decoration:none;border-radius:13px;"><span class="btn-ink" style="color:${L.ctaInk};">${label}</span></a></td></tr></table><!--<![endif]-->
</td></tr></table>`;
  }
  if ("receipt" in b) {
    // The app's own receipt (Pane/Views/AIMarks.swift, AIReceipt): a soft amber capsule, the AI's mark, the summary, Undo.
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:6px auto 22px;"><tr>
<td class="pill" bgcolor="${L.soft}" style="background:${L.soft};border:1px solid #efd3a6;border-radius:22px;padding:10px 16px;font-family:${SANS};font-size:15px;line-height:20px;font-weight:600;color:${L.softInk};white-space:nowrap;">
<img src="${c.assets}/claude.png" width="16" height="16" alt="" style="display:inline-block;width:16px;height:16px;border:0;vertical-align:-3px;">&nbsp; <span class="pill-ink" style="color:${L.softInk};">${esc(b.receipt.text)}</span>&nbsp;&nbsp;<span style="color:#d9b98a;">|</span>&nbsp;&nbsp;<span class="pill-ink" style="color:${L.softInk};">Undo</span>
</td></tr></table>`;
  }
  // Templates: a card each, in its cover's colour, like the gallery on the site.
  return b.templates.map((t) => {
    const ink = t.light ? "#fff8ee" : "#2a1d10";
    const use = `${c.site}/open/template/${t.slug}`;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;"><tr>
<td bgcolor="${t.ground}" style="background:${t.ground};border-radius:16px;padding:12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="88" valign="top" style="width:88px;"><a href="${c.site}/templates/${t.slug}"><img src="${c.assets}/t-${t.slug}.jpg" width="88" height="88" alt="" style="display:block;width:88px;height:88px;border:0;border-radius:10px;"></a></td>
<td valign="middle" style="padding:0 4px 0 14px;font-family:${SANS};">
<a href="${c.site}/templates/${t.slug}" style="font-family:${DISPLAY};font-size:19px;line-height:1.2;font-weight:700;letter-spacing:-0.01em;color:${ink};text-decoration:none;"><span style="color:${ink};">${esc(t.title)}</span></a>
<p style="margin:4px 0 10px;font-size:14px;line-height:1.4;color:${ink};opacity:0.9;">${esc(t.tagline)}</p>
<a href="${use}" style="display:inline-block;padding:6px 12px;border-radius:9px;background:#fff4e6;color:#2a1d10;font-size:14px;font-weight:600;line-height:18px;text-decoration:none;"><span style="color:#2a1d10;">Use template &rarr;</span></a>
</td></tr></table></td></tr></table>`;
  }).join("\n");
}

function htmlOf(d: Draft, c: Context): string {
  const a = c.assets;
  const body = d.blocks.map((b) => blockHTML(b, c)).join("\n");
  const art = d.art ? `  <tr><td bgcolor="${d.art.ground}" style="background:${d.art.ground};border-radius:20px;line-height:0;font-size:0;">
    <img src="${a}/${d.art.file}" width="520" alt="${esc(d.art.alt)}" style="display:block;width:100%;max-width:520px;height:auto;border:0;border-radius:20px;color:#ffffff;font-family:${SANS};font-size:14px;line-height:1.4;">
  </td></tr>
  <tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>
` : "";
  const dot = (color: string) => `<span style="display:inline-block;width:10px;height:10px;border-radius:5px;background:${color};margin-right:6px;"></span>`;
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(d.subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  a { text-decoration-thickness: 1px; text-underline-offset: 2px; }
  @media (max-width: 480px) {
    .pad { padding-left: 20px !important; padding-right: 20px !important; }
    .h1 { font-size: 24px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .ground { background: #2e180a !important; }
    .window { background: #1e1e1e !important; border-color: #3a2a1c !important; }
    .chrome { background: #262626 !important; border-color: #333333 !important; }
    .ink { color: #f5f5f7 !important; }
    .sec { color: #a1a1a6 !important; }
    .muted { color: #d9bf9f !important; }
    .lnk { color: #f5ad33 !important; }
    .foot-lnk { color: #f7b865 !important; }
    .ring { border-color: #6e6e73 !important; }
    .tick { background: #f5ad33 !important; color: #1e1e1e !important; }
    .btn { background: #fbeedd !important; }
    .btn-ink { color: #2e180a !important; }
    .pill { background: #4a3014 !important; border-color: #6b4a22 !important; }
    .pill-ink { color: #fbeedd !important; }
    .rule { border-color: #333333 !important; }
  }
  [data-ogsc] .ink { color: #f5f5f7 !important; }
  [data-ogsc] .sec { color: #a1a1a6 !important; }
  [data-ogsc] .muted { color: #d9bf9f !important; }
  [data-ogsc] .lnk { color: #f5ad33 !important; }
  [data-ogsb] .ground { background: #2e180a !important; }
  [data-ogsb] .window { background: #1e1e1e !important; }
  [data-ogsb] .chrome { background: #262626 !important; }
</style>
</head>
<body class="ground" style="margin:0;padding:0;background:${L.ground};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(d.preview)}${"&#847;&zwnj;&nbsp;".repeat(30)}</div>
<table role="presentation" class="ground" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${L.ground};">
<tr><td align="center" style="padding:28px 12px 40px;">
<!--[if mso]><table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
  <tr><td style="padding:0 4px 18px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding-right:10px;"><img src="${a}/mark.png" width="28" height="28" alt="" style="display:block;border:0;border-radius:7px;"></td>
      <td class="ink" style="font-family:${DISPLAY};font-size:18px;font-weight:700;letter-spacing:-0.01em;color:#2a1d10;">Amber Notes</td>
    </tr></table>
  </td></tr>
${art}  <tr><td class="window" style="background:${L.page};border:1px solid ${L.edge};border-radius:14px;overflow:hidden;box-shadow:0 12px 32px -14px rgba(60,30,5,0.22);">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td class="chrome" style="background:${L.chrome};border-bottom:1px solid ${L.edge};border-radius:14px 14px 0 0;padding:11px 14px;font-family:${SANS};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="70" style="width:70px;line-height:10px;font-size:0;">${dot("#ff5f57")}${dot("#febc2e")}${dot("#28c840")}</td>
          <td class="sec" align="center" style="font-size:13px;font-weight:600;color:${L.secondary};">${esc(d.folder)}</td>
          <td width="70" style="width:70px;">&nbsp;</td>
        </tr></table>
      </td></tr>
      <tr><td class="pad" style="padding:22px 32px 10px;font-family:${SANS};">
        <p class="sec" style="margin:0 0 14px;text-align:center;font-size:13px;line-height:1.4;color:${L.secondary};">From Emil</p>
        <h1 class="ink h1" style="margin:0 0 14px;font-family:${DISPLAY};font-size:27px;line-height:1.2;font-weight:700;letter-spacing:-0.015em;color:${L.text};">${esc(d.title)}</h1>
${body}
      </td></tr>
      <tr><td class="pad" style="padding:0 32px 26px;font-family:${SANS};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="rule" style="border-top:1px solid ${L.edge};padding-top:18px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td valign="middle" style="padding-right:12px;"><img src="${a}/emil.jpg" width="44" height="44" alt="" style="display:block;width:44px;height:44px;border:0;border-radius:22px;"></td>
            <td valign="middle" style="font-family:${SANS};">
              <p class="ink" style="margin:0;font-size:16px;line-height:1.35;font-weight:600;color:${L.text};">Emil</p>
              <p class="sec" style="margin:0;font-size:14px;line-height:1.4;color:${L.secondary};">I make Amber Notes. Replies come straight to me.</p>
            </td>
          </tr></table>
        </td></tr></table>
      </td></tr>
    </table>
  </td></tr>
  <tr><td class="muted" style="padding:20px 8px 0;font-family:${SANS};font-size:13px;line-height:1.55;color:${L.muted};">
    You're getting this because you made an Amber Notes account. I send new accounts a few short emails like this one, and each one stops once you've done what it's about. <a class="foot-lnk" href="${esc(c.unsubscribe)}" style="color:${L.link};">Stop these emails</a>.<br><br>
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
  return { kind, subject: d.subject, preview: d.preview, html: htmlOf(d, c), text: textOf(d, c) };
}

export const KINDS: Kind[] = ["connect", "templates", "undo", "stuck"];
