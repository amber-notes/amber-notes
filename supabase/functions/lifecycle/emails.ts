// The lifecycle emails, in words and in HTML. Each one is a note from Emil, drawn the way the site
// draws notes (the 404 page, the template pages): an Amber Notes window on the cream page, under a
// paper-cut picture from the template covers. Light and dark (Apple Mail, Outlook for Mac and iOS
// read the media query; Outlook.com uses [data-ogsc]/[data-ogsb]; Gmail's apps invert by
// themselves). Tables and inline styles only, images with alt text and the words still complete
// without them, a plain-text twin, and every HTML file well under Gmail's 102 KB clipping limit.
//
// The copy follows the house rules: Emil's voice, short, no em dashes, no invented features. Every
// before/after shows what the MCP tools can do today (supabase/functions/mcp/tools.ts: move_note
// and create_folder, append_to_note and set_checklist_item, edit_note), with made-up notes.
// Nothing here knows what a person's notes say: the inputs are a note count and a few yes/no facts.

import type { Kind } from "./logic.ts";

export const CLAUDE_DIRECTORY_URL = "https://claude.ai/directory/amber-notes";

export type Context = {
  /// The site, for links (https://ambernotes.app).
  site: string;
  /// Where the pictures are: https://ambernotes.app/email in mail, a local folder for previews.
  assets: string;
  /// The page the "Stop these emails" link opens.
  unsubscribe: string;
  /// How many notes the account has, and whether it used Bring your notes (the sorting email says the number).
  noteCount: number;
  imported: boolean;
  /// An AI connection was started and not finished (the AI emails say how the last step goes).
  connectTried: boolean;
};

export type Email = { kind: Kind; subject: string; preview: string; html: string; text: string };

// ---- The words ------------------------------------------------------------------------------------

/// A line in a small drawn note. `added` lines are tinted, the way the app tints what an AI changed.
type Line = { t: string; check?: boolean; done?: boolean; folder?: number; heading?: boolean; added?: boolean };
type Mini = { title: string; folder: string; lines: Line[] };

/// A paragraph with [links](href). Written once, turned into HTML and into plain text.
type Block =
  | { p: string; small?: boolean }
  | { checks: { done: boolean; text: string }[] }
  | { button: { label: string; href: string } }
  | { receipt: { ai: "ChatGPT" | "Claude"; text: string } }
  | { example: { before: Mini; ai: "ChatGPT" | "Claude"; ask: string; after: Mini } }
  | { connect: { tried: boolean } }
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

/// The app's setup card (Pane/Views/SetupCard.swift), with the first step done.
const SETUP: Block = { checks: [
  { done: true, text: "Bring your notes" },
  { done: false, text: "Connect your AI" },
  { done: false, text: "Try it" },
] };

/// A big library gets its number; a small one doesn't.
const many = (c: Context) => c.noteCount >= 20;

function draft(kind: Kind, c: Context): Draft {
  const connect: Block = { connect: { tried: c.connectTried } };
  switch (kind) {
    case "ai_sort":
      return {
        subject: "Let ChatGPT sort your notes into folders",
        preview: many(c)
          ? `You have ${c.noteCount} notes in Amber Notes. ChatGPT or Claude can put them into folders for you.`
          : "ChatGPT or Claude can look through your notes and put each one in a folder.",
        title: many(c) ? `Put ${c.noteCount} notes in folders in one go` : "Put your notes in folders in one go",
        folder: "Notes",
        art: { file: "ai-sort.jpg", ground: "#e4ba8b", alt: "A paper-cut house with a ladder, a toolbox and a paint roller, ready for a tidy-up" },
        blocks: [
          { p: c.imported
            ? "Hi, Emil here. Your notes made it over. If a lot of them sit loose in Notes, your AI can read through them and give each one a folder, which is the kind of job I built Amber Notes for."
            : "Hi, Emil here. If a lot of your notes sit loose in Notes, your AI can read through them and give each one a folder, which is the kind of job I built Amber Notes for." },
          { example: {
            before: { title: "Notes", folder: "6 notes", lines: [
              { t: "Tomato soup" }, { t: "Q4 goals" }, { t: "Lisbon hotels" }, { t: "Pasta with lemon" }, { t: "1:1 with Sara" }, { t: "Packing for Lisbon" },
            ] },
            ai: "ChatGPT",
            ask: "Sort the notes in my Notes folder into folders. Make new folders where it makes sense.",
            after: { title: "Folders", folder: "3 new", lines: [
              { t: "Recipes", folder: 2, added: true }, { t: "Work", folder: 2, added: true }, { t: "Travel", folder: 2, added: true },
            ] },
          } },
          { p: "If you'd like to check before anything moves, ask it to suggest the folders first." },
          SETUP,
          connect,
        ],
      };
    case "ai_groceries":
      return {
        subject: "Your grocery list, kept by ChatGPT",
        preview: "Tell ChatGPT what ran out, and the list in Amber Notes updates itself. Here's what that looks like.",
        title: "Let your AI keep the grocery list",
        folder: "Notes",
        art: { file: "ai-groceries.jpg", ground: "#c83829", alt: "A paper-cut shopping trolley with two paper bags, a baguette, greens and bananas" },
        blocks: [
          { p: "Hi, Emil here. This is the smallest thing Amber Notes does once ChatGPT or Claude is connected, and a good first one to try." },
          { example: {
            before: { title: "Groceries", folder: "Notes", lines: [
              { t: "Eggs", check: true }, { t: "Bread", check: true }, { t: "Coffee beans", check: true },
            ] },
            ai: "ChatGPT",
            ask: "We're out of oat milk and lemons. And I already bought eggs.",
            after: { title: "Groceries", folder: "Notes", lines: [
              { t: "Eggs", check: true, done: true, added: true }, { t: "Bread", check: true }, { t: "Coffee beans", check: true },
              { t: "Oat milk", check: true, added: true }, { t: "Lemons", check: true, added: true },
            ] },
          } },
          { p: "The note on your Mac changes a moment later, with Undo in case it got something wrong." },
          SETUP,
          connect,
        ],
      };
    case "ai_meeting":
      return {
        subject: "Turn a messy note into a to-do list",
        preview: "Claude can read a note you wrote in a hurry and pull out who does what. Before and after inside.",
        title: "From messy note to action items",
        folder: "Notes",
        art: { file: "ai-meeting.jpg", ground: "#ec7751", alt: "A paper-cut meeting table from above, with coffee cups, sticky notes and a notebook" },
        blocks: [
          { p: "Hi, Emil here. Notes written in a hurry rarely say who does what. Claude can read one and put the action items at the top, and leave the rest as you wrote it." },
          { example: {
            before: { title: "Monday sync", folder: "Work", lines: [
              { t: "pricing page still not live, Sara thinks thu" }, { t: "jonas to check VAT for norway??" }, { t: "need new screenshots before launch" }, { t: "emma design review checkout" },
            ] },
            ai: "Claude",
            ask: "Put the action items from my Monday sync note at the top as a checklist. Keep the rest as it is.",
            after: { title: "Monday sync", folder: "Work", lines: [
              { t: "Action items", heading: true, added: true },
              { t: "Sara: pricing page live by Thursday", check: true, added: true },
              { t: "Jonas: check VAT rules for Norway", check: true, added: true },
              { t: "Emma: design review of the checkout", check: true, added: true },
              { t: "New screenshots before launch (who?)", check: true, added: true },
              { t: "pricing page still not live, Sara thinks thu" }, { t: "…" },
            ] },
          } },
          { receipt: { ai: "Claude", text: "Claude changed 6 lines" } },
          { p: "That bar shows on the note when the change lands. Undo puts the note back the way it was." },
          SETUP,
          connect,
        ],
      };
    case "templates":
      return {
        subject: "Three notes your AI can keep for you",
        preview: "A grocery list, a trip plan and a weekly review, each with the instructions to give ChatGPT or Claude.",
        title: "Three templates to try",
        folder: "Notes",
        blocks: [
          { p: "Your AI is connected, so here's something to give it. A template is a note plus a few lines of instructions for your AI. Use template adds the note to Amber Notes. You paste the instructions into ChatGPT or Claude once, and from then on it keeps the note up to date for you." },
          { templates: TEMPLATES },
          { p: `Each template's page has its instructions, with a Copy button. [See all the templates](${c.site}/templates).` },
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
          { p: "When your AI edits the note you have open, this appears at the bottom of it. Undo puts the note back the way it was. A note it changed while you were away is marked \"Edited by Claude\" (or ChatGPT) in the list until you open it." },
          { p: "Older changes are in the note's version history. Try it on any note:" },
          { checks: [
            { done: false, text: "Open a note" },
            { done: false, text: "Choose More (•••), then Show Version History" },
          ] },
          { p: "Every earlier version is there by day, and you can bring any of them back. Versions that an AI made are kept for 90 days." },
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
          { button: { label: "Reply to Emil", href: "mailto:emil@ambernotes.app?subject=Stuck%20after%20signing%20in" } },
          { p: "Have notes in Apple Notes? On the Mac, choose File, then Import from Apple Notes. It brings them all over with their folders, and Apple Notes stays as it is.", small: true },
        ],
      };
  }
}

/// The two ways to connect, the same in every AI email.
function connectWords(c: Context, tried: boolean) {
  return {
    heading: "Connect in a few minutes",
    chatgpt: `In Amber Notes, open Settings and choose Connect an AI, then ChatGPT. The app shows each step. It needs ChatGPT Plus or higher, on chatgpt.com. [The guide](${guide(c)}) has pictures.`,
    claude: `[Open Amber Notes in Claude's directory](${CLAUDE_DIRECTORY_URL}) and choose Connect to Claude.`,
    approve: "Either way, you approve it on your iPhone or Mac by typing the number the page shows, and you can choose Read Only.",
    tried: tried ? "Started connecting and it didn't finish? The last step happens on your iPhone or Mac: open Amber Notes there and type the number from the page." : null,
  };
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
    else if ("example" in b) {
      const mini = (m: Mini) => [`  ${m.title} (${m.folder})`, ...m.lines.map((l) => `  ${l.check ? (l.done ? "[x] " : "[ ] ") : l.folder !== undefined ? "Folder: " : "- "}${l.t}${l.folder !== undefined ? ` (${l.folder})` : ""}`)];
      out.push("Before:", ...mini(b.example.before), "", `You, in ${b.example.ai}: "${b.example.ask}"`, "", "After:", ...mini(b.example.after), "");
    } else if ("connect" in b) {
      const w = connectWords(c, b.connect.tried);
      out.push(w.heading, "", `ChatGPT: ${plain(w.chatgpt)}`, "", `Claude: ${plain(w.claude)}`, "", w.approve, "");
      if (w.tried) out.push(w.tried, "");
    }
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
  accent: "#e39410", accentText: "#b86e00", muted: "#74604c", link: "#a85700", cta: "#2a1d10", ctaInk: "#fff4e6", soft: "#fbe8c8", softInk: "#5c3400", tray: "#f7f3ec", tint: "#fdf0d8" };

function inline(s: string, linkClass: string, color: string): string {
  let out = "", last = 0;
  for (const m of s.matchAll(LINK)) {
    out += esc(s.slice(last, m.index));
    out += `<a class="${linkClass}" href="${esc(m[2])}" style="color:${color};text-decoration:underline;text-decoration-color:${L.accent};">${esc(m[1])}</a>`;
    last = m.index! + m[0].length;
  }
  return out + esc(s.slice(last));
}

/// A small note, the way the app draws one: title, folder, lines; what an AI changed is tinted.
function miniHTML(m: Mini): string {
  const rows = m.lines.map((l) => {
    const tint = l.added ? `background:${L.tint};` : "";
    const lead = l.check
      ? (l.done
        ? `<span class="tick" style="display:inline-block;width:15px;height:15px;border-radius:8px;background:${L.accent};color:#ffffff;font-size:10px;line-height:15px;text-align:center;font-weight:700;">&#10003;</span>`
        : `<span class="ring" style="display:inline-block;width:12px;height:12px;border-radius:8px;border:1.5px solid ${L.circle};"></span>`)
      : l.folder !== undefined ? `<span style="color:${L.accent};font-size:13px;">&#9634;</span>` : "";
    const text = l.heading
      ? `<b class="ink" style="color:${L.text};font-size:15px;">${esc(l.t)}</b>`
      : `<span class="${l.done ? "sec" : "ink"}" style="color:${l.done ? L.secondary : L.text};${l.done ? "text-decoration:line-through;" : ""}">${esc(l.t)}</span>`;
    const count = l.folder !== undefined ? `<td class="sec${l.added ? " tint" : ""}" align="right" style="padding:3px 8px;font-size:13px;color:${L.secondary};${tint}">${l.folder}</td>` : "";
    return `<tr><td width="22" class="${l.added ? "tint" : ""}" style="width:22px;padding:3px 0 3px 8px;${tint}">${lead}</td><td class="${l.added ? "tint" : ""}" style="padding:3px 8px 3px 4px;font-family:${SANS};font-size:14px;line-height:1.4;${tint}">${text}</td>${count}</tr>`;
  }).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="mini" style="background:${L.page};border:1px solid ${L.edge};border-radius:10px;"><tr><td style="padding:10px 6px 8px;">
<p class="ink" style="margin:0 8px 6px;font-family:${DISPLAY};font-size:15px;line-height:1.3;font-weight:700;color:${L.text};">${esc(m.title)} <span class="sec" style="font-weight:400;font-size:12px;color:${L.secondary};">· ${esc(m.folder)}</span></p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
</td></tr></table>`;
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
<img src="${c.assets}/${b.receipt.ai === "Claude" ? "claude" : "chatgpt"}.png" width="16" height="16" alt="" style="display:inline-block;width:16px;height:16px;border:0;vertical-align:-3px;">&nbsp; <span class="pill-ink" style="color:${L.softInk};">${esc(b.receipt.text)}</span>&nbsp;&nbsp;<span style="color:#d9b98a;">|</span>&nbsp;&nbsp;<span class="pill-ink" style="color:${L.softInk};">Undo</span>
</td></tr></table>`;
  }
  if ("example" in b) {
    const e = b.example;
    const glyph = `${c.assets}/${e.ai === "Claude" ? "claude" : "chatgpt"}.png`;
    const label = (t: string) => `<p class="sec" style="margin:0 0 6px;font-size:12px;line-height:1.3;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${L.secondary};">${t}</p>`;
    const ask = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0;"><tr><td align="right">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#efece6;border-radius:18px;padding:10px 14px;font-family:${SANS};font-size:15px;line-height:1.4;color:#1d1d1f;">
<img src="${glyph}" width="14" height="14" alt="" style="display:inline-block;width:14px;height:14px;border:0;vertical-align:-2px;"> <span style="color:#6e6e73;font-size:13px;font-weight:600;">You, in ${e.ai}</span><br><span style="color:#1d1d1f;">${esc(e.ask)}</span>
</td></tr></table></td></tr></table>`;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px;"><tr><td class="tray" style="background:${L.tray};border-radius:14px;padding:16px;">
${label("Before")}${miniHTML(e.before)}
${ask}
${label("After")}${miniHTML(e.after)}
</td></tr></table>`;
  }
  if ("connect" in b) {
    const w = connectWords(c, b.connect.tried);
    const row = (img: string, name: string, text: string) => `<tr><td width="34" valign="top" style="width:34px;padding:0 0 12px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#ffffff" style="background:#ffffff;border:1px solid #e6e2dc;border-radius:7px;padding:4px;line-height:0;"><img src="${c.assets}/${img}.png" width="16" height="16" alt="" style="display:block;width:16px;height:16px;border:0;"></td></tr></table></td>
<td class="ink" style="padding:0 0 12px;font-family:${SANS};font-size:15px;line-height:1.5;color:${L.text};"><b>${name}.</b> ${inline(text, "lnk", L.accentText)}</td></tr>`;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px;"><tr><td class="tray" style="background:${L.tray};border-radius:14px;padding:16px 16px 6px;">
<p class="ink" style="margin:0 0 12px;font-family:${DISPLAY};font-size:18px;line-height:1.3;font-weight:700;color:${L.text};">${esc(w.heading)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${row("chatgpt", "ChatGPT", w.chatgpt)}${row("claude", "Claude", w.claude)}</table>
<p class="sec" style="margin:0 0 10px;font-size:14px;line-height:1.5;color:${L.secondary};">${esc(w.approve)}</p>
${w.tried ? `<p class="ink" style="margin:0 0 10px;font-size:14px;line-height:1.5;color:${L.text};">${esc(w.tried)}</p>` : ""}
</td></tr></table>
${blockHTML({ button: { label: "Show me how", href: guide(c) } }, c)}`;
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
    .tray { background: #2a2a2a !important; }
    .mini { background: #1e1e1e !important; border-color: #3a3a3a !important; }
    .tint { background: #3d2c12 !important; }
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

export const KINDS: Kind[] = ["stuck", "ai_sort", "ai_groceries", "ai_meeting", "templates", "undo"];
