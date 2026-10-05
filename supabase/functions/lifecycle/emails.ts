// The lifecycle emails, in words and in HTML. Each one is a note from Emil, drawn the way the site
// draws notes (the 404 page, the template pages): an Amber Notes window on the cream page, under a
// paper-cut picture from the template covers.
//
// Built for real mail apps (docs/Technical/lifecycle-emails.md has the client notes):
// - tables and inline styles; no flex, grid, background images, web fonts or SVG;
// - shapes that must show everywhere (checkboxes, window dots) are table cells, so Outlook for
//   Windows draws them as squares instead of dropping them; rounding is a bonus where supported;
// - three <style> blocks, so a client that drops one (Gmail drops a block it doesn't like) keeps
//   the others: phone spacing, dark mode for Apple Mail and Outlook apps, Outlook.com's dark mode;
// - no pure white or black, and the AI marks carry their own white tile inside the PNG, so Gmail's
//   forced dark mode (it inverts colours, never images) can't hide them;
// - a plain-text twin, and every HTML file far under Gmail's 102 KB clipping limit.
//
// The copy follows the house rules: Emil's voice, short, no em dashes, no invented features. Every
// before/after shows what the MCP tools can do today (supabase/functions/mcp/tools.ts: move_note
// and create_folder, append_to_note and set_checklist_item, edit_note), with made-up notes.
// Nothing here knows what a person's notes say: the inputs are a note count and a few yes/no facts.

import type { Kind } from "./logic.ts";

export const CLAUDE_DIRECTORY_URL = "https://claude.ai/directory/amber-notes";
export const APP_STORE_URL = "https://apps.apple.com/app/id6817253103";

export type Context = {
  /// The site, for links (https://ambernotes.app).
  site: string;
  /// Where the pictures are: https://ambernotes.app/email in mail, a local folder for previews.
  assets: string;
  /// The page the "Stop these emails" link opens.
  unsubscribe: string;
  /// How many notes the account has, and whether it imported (the connect email picks its example by it).
  noteCount: number;
  imported: boolean;
  /// An AI connection was started and is waiting (the connect email says how the last step goes).
  connectTried: boolean;
  /// The template cards' look. "paper" is the chosen one; "amber" is kept for comparison.
  cards?: "paper" | "amber";
};

export type Email = { kind: Kind; subject: string; preview: string; html: string; text: string };

// ---- The words ------------------------------------------------------------------------------------

/// A line in a small drawn note. `added` lines are tinted, the way the app tints what an AI changed.
type Line = { t: string; check?: boolean; done?: boolean; folder?: number; heading?: boolean; added?: boolean };
type Mini = { title: string; folder: string; lines: Line[] };
type AI = "ChatGPT" | "Claude";

/// A paragraph with [links](href). Written once, turned into HTML and into plain text.
type Block =
  | { p: string; small?: boolean }
  | { checks: { done: boolean; text: string }[] }
  | { button: { label: string; href: string } }
  | { receipt: { ai: AI; text: string } }
  | { example: { before: Mini; ai: AI; ask: string; after: Mini } }
  | { prompts: string[] }
  | { templates: Template[] };

type Template = { slug: string; title: string; tagline: string };

type Draft = {
  subject: string;
  preview: string;
  /// The note's title, and the window's folder.
  title: string;
  folder: string;
  /// The paper-cut picture at the top, from the template covers, and what it shows. The templates
  /// email has none: its template cards carry the pictures.
  art?: { file: string; ground: string; alt: string };
  blocks: Block[];
};

const TEMPLATES: Template[] = [
  { slug: "grocery-list", title: "Grocery list", tagline: "Sorted by aisle, before you get to the shop." },
  { slug: "trip-plan", title: "Trip plan", tagline: "Days, bookings and the packing list in one place." },
  { slug: "weekly-review", title: "Weekly review", tagline: "Five questions every Sunday, written up for you." },
];

const guide = (c: Context) => `${c.site}/blog/connect-chatgpt-to-your-notes`;

/// The app's setup card (Pane/Views/SetupCard.swift), with the first step done.
const SETUP: Block = { checks: [
  { done: true, text: "Bring your notes" },
  { done: false, text: "Connect your AI" },
  { done: false, text: "Try it" },
] };

/// A big or imported library is shown sorting itself; a small one, a grocery list.
const bigLibrary = (c: Context) => c.imported || c.noteCount >= 20;

function draft(kind: Kind, c: Context): Draft {
  switch (kind) {
    case "stuck":
      return {
        subject: "Did something go wrong after signing in?",
        preview: "Your Amber Notes account has no notes yet. If the app got in your way, I'd like to know.",
        title: "Did something get stuck?",
        folder: "Notes",
        art: { file: "stuck.jpg", ground: "#e9a82a", alt: "A paper-cut ladybird on a leaf, next to a magnifying glass and a toolbox" },
        blocks: [
          { p: "Hi, I'm Emil, and I make Amber Notes. You made an account, but no notes have arrived yet. If something after signing in was confusing or got stuck, tell me and I'll help you get going." },
          { button: { label: "Reply to Emil", href: "mailto:emil@ambernotes.app?subject=Stuck%20after%20signing%20in" } },
          { p: "Notes in Apple Notes? On the Mac, choose File, then Import from Apple Notes.", small: true },
        ],
      };
    case "import":
      return {
        subject: "Bring your Apple Notes over",
        preview: "One menu on the Mac brings your notes across with their folders. Apple Notes stays as it is.",
        title: "Bring your Apple Notes over",
        folder: "Notes",
        art: { file: "import.jpg", ground: "#e4ba8b", alt: "A paper-cut house with a ladder, a toolbox and a paint roller, ready to move in" },
        blocks: [
          { p: "Hi, Emil here. Amber Notes on your Mac can bring your notes over from Apple Notes, folders included, and Apple Notes stays exactly as it is." },
          { checks: [
            { done: false, text: "Open Amber Notes on your Mac" },
            { done: false, text: "Choose File, then Import from Apple Notes" },
          ] },
          { button: { label: "How importing works", href: `${c.site}/blog/move-from-apple-notes` } },
          { p: "You can bring all of them, or just some folders.", small: true },
        ],
      };
    case "connect": {
      const big = bigLibrary(c);
      const last = c.connectTried
        ? "Started connecting? Finish by typing the number the page shows into Amber Notes on your iPhone or Mac."
        : "In the app: Settings, then Connect an AI. You approve it on your iPhone or Mac.";
      return big
        ? {
          subject: "Let ChatGPT sort your notes into folders",
          preview: c.noteCount >= 20
            ? `You have ${c.noteCount} notes in Amber Notes. ChatGPT or Claude can put them into folders for you.`
            : "ChatGPT or Claude can read through your notes and put each one in a folder.",
          title: c.noteCount >= 20 ? `Put ${c.noteCount} notes in folders in one go` : "Put your notes in folders in one go",
          folder: "Notes",
          art: { file: "connect-sort.jpg", ground: "#3f5c86", alt: "A paper-cut stack of books under a warm desk lamp, beside a plant" },
          blocks: [
            { p: "Hi, Emil here. Connect ChatGPT or Claude and ask it to sort your notes. It reads them and makes the folders." },
            { example: {
              before: { title: "Notes", folder: "6 notes", lines: [
                { t: "Tomato soup" }, { t: "Q4 goals" }, { t: "Lisbon hotels" }, { t: "Pasta with lemon" }, { t: "1:1 with Sara" }, { t: "Packing for Lisbon" },
              ] },
              ai: "ChatGPT",
              ask: "Sort the notes in my Notes folder into folders.",
              after: { title: "Folders", folder: "3 new", lines: [
                { t: "Recipes", folder: 2, added: true }, { t: "Work", folder: 2, added: true }, { t: "Travel", folder: 2, added: true },
              ] },
            } },
            SETUP,
            { button: { label: "Connect in a few minutes", href: guide(c) } },
            { p: last, small: true },
          ],
        }
        : {
          subject: "Your grocery list, kept by ChatGPT",
          preview: "Tell ChatGPT what ran out, and the list in Amber Notes updates itself. Here's what that looks like.",
          title: "Let your AI keep the grocery list",
          folder: "Notes",
          art: { file: "connect-groceries.jpg", ground: "#c83829", alt: "A paper-cut shopping trolley with two paper bags, a baguette, greens and bananas" },
          blocks: [
            { p: "Hi, Emil here. Connect ChatGPT or Claude, then tell it what ran out. The list in Amber Notes updates itself." },
            { example: {
              before: { title: "Groceries", folder: "Notes", lines: [
                { t: "Eggs", check: true }, { t: "Bread", check: true }, { t: "Coffee beans", check: true },
              ] },
              ai: "ChatGPT",
              ask: "We're out of oat milk and lemons. I already bought eggs.",
              after: { title: "Groceries", folder: "Notes", lines: [
                { t: "Eggs", check: true, done: true, added: true }, { t: "Bread", check: true }, { t: "Coffee beans", check: true },
                { t: "Oat milk", check: true, added: true }, { t: "Lemons", check: true, added: true },
              ] },
            } },
            SETUP,
            { button: { label: "Connect in a few minutes", href: guide(c) } },
            { p: last, small: true },
          ],
        };
    }
    case "try":
      return {
        subject: "Three things to ask your AI first",
        preview: "Your AI is connected. Paste one of these into ChatGPT or Claude and watch the note change.",
        title: "Try this first",
        folder: "Notes",
        art: { file: "try.jpg", ground: "#2e346d", alt: "Two paper-cut armchairs with a mug each, ready for a chat" },
        blocks: [
          { p: "Your AI is connected. Paste one of these into ChatGPT or Claude and watch your notes change." },
          { prompts: [
            "Add \"Call mom\" to a To-do note in my Amber Notes. Make the note if there isn't one.",
            "Search my Amber Notes and tell me what I wrote most recently.",
            "Find my latest meeting note in Amber Notes and put its action items at the top as a checklist.",
          ] },
          { button: { label: "Open ChatGPT", href: "https://chatgpt.com" } },
          { p: "In ChatGPT, start a new chat and add Amber Notes from the tools menu first.", small: true },
        ],
      };
    case "undo":
      return {
        subject: "Every AI edit comes with Undo",
        preview: "Your AI made its first change. Here's how to see it, and how to take any change back.",
        title: "You can always put it back",
        folder: "Notes",
        art: { file: "undo.jpg", ground: "#754024", alt: "A paper-cut signpost where a path splits in two, with a compass in the grass" },
        blocks: [
          { p: "Your AI made its first change. Every change shows this bar on the note, and Undo puts the note back." },
          { receipt: { ai: "Claude", text: "Claude changed 3 lines" } },
          { checks: [
            { done: false, text: "Open a note" },
            { done: false, text: "Choose More (•••), then Show Version History" },
          ] },
          { p: "Versions an AI made are kept for 90 days.", small: true },
        ],
      };
    case "apps":
      // Behind APPS_LIVE. Check the words against the shipped feature before turning it on.
      return {
        subject: "Your notes can be apps",
        preview: "A note in Amber Notes can be a small app now, like a habit tracker. Start from the template.",
        title: "Your notes can be apps",
        folder: "Notes",
        art: { file: "apps.jpg", ground: "#92a36f", alt: "Paper-cut running shoes and a glass of water at the foot of a winding hill path" },
        blocks: [
          { p: "Hi, Emil here. A note can be a small app now, like a habit tracker you tick off every day. Start from the template, or ask your AI to make one." },
          { button: { label: "Use the habit tracker", href: `${c.site}/open/template/habit-tracker` } },
          { p: `[See how it works](${c.site}/templates/habit-tracker)`, small: true },
        ],
      };
    case "templates":
      return {
        subject: "Three notes your AI can keep for you",
        preview: "A grocery list, a trip plan and a weekly review, each with the instructions to give ChatGPT or Claude.",
        title: "Three templates to try",
        folder: "Notes",
        blocks: [
          { p: "A template is a note plus instructions for your AI. Add the note, paste the instructions into ChatGPT or Claude once, and it keeps the note up to date." },
          { templates: TEMPLATES },
          { button: { label: "See all templates", href: `${c.site}/templates` } },
        ],
      };
    case "iphone":
      // Behind APP_STORE_LIVE.
      return {
        subject: "Amber Notes is on iPhone",
        preview: "Sign in with the same account and your notes are there, with your AI's changes.",
        title: "Your notes, on your iPhone",
        folder: "Notes",
        art: { file: "iphone.jpg", ground: "#69b5e9", alt: "A paper-cut briefcase with a paper airplane flying toward the sun" },
        blocks: [
          { p: "Hi, Emil here. Amber Notes is in the App Store. Sign in with the same account, and your notes are there, with everything your AI changed." },
          { button: { label: "Get it on the App Store", href: APP_STORE_URL } },
          { p: "Your key comes along through iCloud Keychain, so your notes open right away.", small: true },
        ],
      };
    case "share":
      // Behind SHARING_LIVE. Check the words against the shipped feature before turning it on.
      return {
        subject: "Share a note with someone",
        preview: "A grocery list for the house or a trip plan for two works better shared.",
        title: "Some notes are for two",
        folder: "Notes",
        art: { file: "share.jpg", ground: "#7cbf91", alt: "Paper-cut wrapped gift boxes with ribbons, a gift tag and confetti" },
        blocks: [
          { p: "Hi, Emil here. A grocery list for the house or a trip plan for two works better shared. Share a note from its Share menu." },
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
  const mini = (m: Mini) => [`  ${m.title} (${m.folder})`, ...m.lines.map((l) => `  ${l.check ? (l.done ? "[x] " : "[ ] ") : l.folder !== undefined ? "Folder: " : "- "}${l.t}${l.folder !== undefined ? ` (${l.folder})` : ""}`)];
  for (const b of d.blocks) {
    if ("p" in b) out.push(plain(b.p), "");
    else if ("checks" in b) out.push(...b.checks.map((x) => `${x.done ? "[x]" : "[ ]"} ${x.text}`), "");
    else if ("button" in b) out.push(`${b.button.label}: ${b.button.href.replace(/^mailto:([^?]+).*/, "$1")}`, "");
    else if ("receipt" in b) out.push(`  ${b.receipt.text}  |  Undo`, "");
    else if ("example" in b) out.push("Before:", ...mini(b.example.before), "", `You, in ${b.example.ai}: "${b.example.ask}"`, "", "After:", ...mini(b.example.after), "");
    else if ("prompts" in b) out.push(...b.prompts.map((x) => `> ${x}`), "");
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

// The site's tokens (web/app/site.css for the page, web/app/globals.css for the note), with the
// note's white and the text's near-black kept off the extremes so forced inversion stays soft.
const L = { ground: "#fff4e6", page: "#fffdf9", chrome: "#f6f5f3", edge: "#ebe6df", text: "#1d1d1f", secondary: "#6e6e73", circle: "#aeaeb2",
  accent: "#e39410", accentText: "#b86e00", muted: "#74604c", link: "#a85700", cta: "#2a1d10", ctaInk: "#fff4e6", soft: "#fbe8c8", softInk: "#5c3400",
  tray: "#f7f3ec", tint: "#fdf0d8", paper: "#fffaf3", paperEdge: "#f0e2cf" };

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

/// The AI's mark, on its own white tile (inside the PNG, so no client can recolour the tile).
const mark = (c: Context, ai: AI, size: number) =>
  `<img src="${c.assets}/${ai === "Claude" ? "claude" : "chatgpt"}-tile.png" width="${size}" height="${size}" alt="" style="display:inline-block;width:${size}px;height:${size}px;border:0;vertical-align:middle;">`;

/// A small note, the way the app draws one: title, folder, lines; what an AI changed is tinted.
function miniHTML(m: Mini): string {
  const rows = m.lines.map((l) => {
    const tint = l.added ? `background:${L.tint};` : "";
    const cls = l.added ? ` class="tint"` : "";
    const lead = l.check ? box(!!l.done, 15) : l.folder !== undefined ? `<span style="color:${L.accent};font-size:13px;">&#9634;</span>` : "";
    const text = l.heading
      ? `<b class="ink" style="color:${L.text};font-size:15px;">${esc(l.t)}</b>`
      : `<span class="${l.done ? "sec" : "ink"}" style="color:${l.done ? L.secondary : L.text};${l.done ? "text-decoration:line-through;" : ""}">${esc(l.t)}</span>`;
    const count = l.folder !== undefined ? `<td${cls} align="right" style="padding:4px 8px;font-size:13px;color:${L.secondary};${tint}"><span class="sec" style="color:${L.secondary};">${l.folder}</span></td>` : "";
    return `<tr><td${cls} width="24" style="width:24px;padding:4px 0 4px 8px;${tint}">${lead}</td><td${cls} style="padding:4px 8px 4px 4px;font-family:${SANS};font-size:14px;line-height:1.4;${tint}">${text}</td>${count}</tr>`;
  }).join("");
  return `${table(` width="100%" class="mini" bgcolor="${L.page}" style="background:${L.page};border:1px solid ${L.edge};border-radius:10px;"`)}<tr><td style="padding:10px 6px 8px;">
<p class="ink" style="margin:0 8px 6px;font-family:${DISPLAY};font-size:15px;line-height:1.3;font-weight:700;color:${L.text};">${esc(m.title)} <span class="sec" style="font-weight:400;font-size:12px;color:${L.secondary};">· ${esc(m.folder)}</span></p>
${table(' width="100%"')}${rows}</table>
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
  if ("receipt" in b) {
    // The app's own receipt (Pane/Views/AIMarks.swift, AIReceipt): a soft amber capsule, the AI's mark, the summary, Undo.
    return `${table(' align="center" style="margin:4px auto 20px;"')}<tr>
<td class="pill" bgcolor="${L.soft}" style="background:${L.soft};border:1px solid #efd3a6;border-radius:22px;padding:9px 16px;font-family:${SANS};font-size:15px;line-height:20px;font-weight:600;color:${L.softInk};white-space:nowrap;">
${mark(c, b.receipt.ai, 18)}&nbsp; <span class="pill-ink" style="color:${L.softInk};">${esc(b.receipt.text)}</span>&nbsp;&nbsp;<span style="color:#d9b98a;">|</span>&nbsp;&nbsp;<span class="pill-ink" style="color:${L.softInk};">Undo</span>
</td></tr></table>`;
  }
  if ("example" in b) {
    const e = b.example;
    const label = (t: string) => `<p class="sec" style="margin:0 0 6px;font-size:12px;line-height:1.3;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${L.secondary};">${t}</p>`;
    const ask = `${table(' width="100%" style="margin:14px 0;"')}<tr><td align="right">
${table()}<tr><td class="bubble" bgcolor="#efece6" style="background:#efece6;border-radius:18px;padding:10px 14px;font-family:${SANS};font-size:15px;line-height:1.4;color:${L.text};">
${mark(c, e.ai, 16)} <span class="sec" style="color:${L.secondary};font-size:13px;font-weight:600;">You, in ${e.ai}</span><br><span class="ink" style="color:${L.text};">${esc(e.ask)}</span>
</td></tr></table></td></tr></table>`;
    return `${table(' width="100%" style="margin:2px 0 18px;"')}<tr><td class="tray" bgcolor="${L.tray}" style="background:${L.tray};border-radius:14px;padding:16px;">
${label("Before")}${miniHTML(e.before)}
${ask}
${label("After")}${miniHTML(e.after)}
</td></tr></table>`;
  }
  if ("prompts" in b) {
    return b.prompts.map((x) => `${table(' width="100%" style="margin:0 0 10px;"')}<tr><td class="tray" bgcolor="${L.tray}" style="background:${L.tray};border-left:3px solid ${L.accent};border-radius:10px;padding:12px 14px;font-family:${SANS};font-size:15px;line-height:1.45;color:${L.text};"><span class="ink" style="color:${L.text};">${esc(x)}</span></td></tr></table>`).join("\n")
      + `<div style="height:8px;line-height:8px;font-size:0;">&nbsp;</div>`;
  }
  // Templates: calm cards, all alike; the cover thumbnail carries the colour.
  const amber = c.cards === "amber";
  const grounds = ["#fbecd5", "#f8e3c4", "#f5dab3"];
  return b.templates.map((t, i) => {
    const bg = amber ? grounds[i % grounds.length] : L.paper;
    const border = amber ? "transparent" : L.paperEdge;
    const use = `${c.site}/open/template/${t.slug}`;
    return `${table(' width="100%" style="margin:0 0 10px;"')}<tr>
<td class="${amber ? "acard" : "card"}" bgcolor="${bg}" style="background:${bg};border:1px solid ${border};border-radius:16px;padding:12px;">
${table(' width="100%"')}<tr>
<td width="76" valign="middle" style="width:76px;"><a href="${c.site}/templates/${t.slug}"><img src="${c.assets}/t-${t.slug}.jpg" width="76" height="76" alt="" style="display:block;width:76px;height:76px;border:0;border-radius:12px;"></a></td>
<td valign="middle" style="padding:0 2px 0 14px;font-family:${SANS};">
<a href="${c.site}/templates/${t.slug}" style="font-family:${DISPLAY};font-size:17px;line-height:1.25;font-weight:700;color:${L.text};text-decoration:none;"><span class="ink" style="color:${L.text};">${esc(t.title)}</span></a>
<p class="sec" style="margin:3px 0 9px;font-size:14px;line-height:1.4;color:${L.secondary};">${esc(t.tagline)}</p>
<a href="${use}" style="font-size:14px;font-weight:600;line-height:18px;color:${L.accentText};text-decoration:none;"><span class="lnk" style="color:${L.accentText};">Use template &rarr;</span></a>
</td></tr></table></td></tr></table>`;
  }).join("\n") + `<div style="height:8px;line-height:8px;font-size:0;">&nbsp;</div>`;
}

function htmlOf(d: Draft, c: Context): string {
  const a = c.assets;
  const body = d.blocks.map((b) => blockHTML(b, c)).join("\n");
  const dot = (color: string) => `<td width="10" height="10" bgcolor="${color}" style="width:10px;height:10px;border-radius:5px;background:${color};font-size:0;line-height:0;">&nbsp;</td><td width="6" style="width:6px;font-size:0;line-height:0;">&nbsp;</td>`;
  const art = d.art ? `  <tr><td bgcolor="${d.art.ground}" style="background:${d.art.ground};border-radius:20px;line-height:0;font-size:0;">
    <img src="${a}/${d.art.file}" width="520" height="312" alt="${esc(d.art.alt)}" style="display:block;width:100%;max-width:520px;height:auto;border:0;border-radius:20px;color:#fff4e6;font-family:${SANS};font-size:14px;line-height:1.4;">
  </td></tr>
  <tr><td class="gap" style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>
` : "";
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
  @media (max-width: 480px) {
    .outer { padding: 16px 8px 32px !important; }
    .pad { padding-left: 24px !important; padding-right: 24px !important; }
    .padtop { padding-top: 26px !important; }
    .dateline { display: none !important; }
    .h1 { font-size: 25px !important; line-height: 1.2 !important; margin-bottom: 16px !important; }
    .body { line-height: 1.62 !important; margin-bottom: 22px !important; }
    .small { line-height: 1.6 !important; }
    .crow { padding-bottom: 16px !important; }
    .gap { height: 12px !important; }
  }
</style>
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
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
    .tray { background: #2a2a2a !important; }
    .bubble { background: #3a3a3c !important; }
    .mini { background: #1e1e1e !important; border-color: #3a3a3a !important; }
    .tint { background: #3d2c12 !important; }
    .card { background: #2a2a2a !important; border-color: #3a3a3a !important; }
    .acard { background: #3a2a16 !important; }
  }
</style>
<style>
  [data-ogsc] .ink { color: #f5f5f7 !important; }
  [data-ogsc] .sec { color: #a1a1a6 !important; }
  [data-ogsc] .muted { color: #d9bf9f !important; }
  [data-ogsc] .lnk { color: #f5ad33 !important; }
  [data-ogsb] .ground { background: #2e180a !important; }
  [data-ogsb] .window { background: #1e1e1e !important; }
  [data-ogsb] .chrome { background: #262626 !important; }
  [data-ogsb] .tray, [data-ogsb] .card, [data-ogsb] .bubble { background: #2a2a2a !important; }
  [data-ogsb] .mini { background: #1e1e1e !important; }
  [data-ogsb] .tint { background: #3d2c12 !important; }
  [data-ogsb] .pill { background: #4a3014 !important; }
  [data-ogsc] .pill-ink { color: #fbeedd !important; }
</style>
</head>
<body class="ground" style="margin:0;padding:0;background:${L.ground};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(d.preview)}${"&#847;&zwnj;&nbsp;".repeat(30)}</div>
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
${art}  <tr><td class="window" bgcolor="${L.page}" style="background:${L.page};border:1px solid ${L.edge};border-radius:14px;">
    ${table(' width="100%"')}
      <tr><td class="chrome" bgcolor="${L.chrome}" style="background:${L.chrome};border-bottom:1px solid ${L.edge};border-radius:14px 14px 0 0;padding:11px 14px;font-family:${SANS};">
        ${table(' width="100%"')}<tr>
          <td width="70" style="width:70px;">${table()}<tr>${dot("#ff5f57")}${dot("#febc2e")}${dot("#28c840")}</tr></table></td>
          <td class="sec" align="center" style="font-size:13px;font-weight:600;color:${L.secondary};">${esc(d.folder)}</td>
          <td width="70" style="width:70px;">&nbsp;</td>
        </tr></table>
      </td></tr>
      <tr><td class="pad padtop" style="padding:22px 32px 6px;font-family:${SANS};">
        <p class="sec dateline" style="margin:0 0 14px;text-align:center;font-size:13px;line-height:1.4;color:${L.secondary};">From Emil</p>
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
  return { kind, subject: d.subject, preview: d.preview, html: htmlOf(d, c), text: textOf(d, c) };
}

export const KINDS: Kind[] = ["stuck", "import", "connect", "try", "undo", "apps", "templates", "iphone", "share"];
