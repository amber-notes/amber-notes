// The Supabase Auth emails (sign-in code, reset, confirmations, notices), in the lifecycle emails'
// look (supabase/functions/lifecycle/emails.ts): the mark, cream ground, a window with a title bar,
// one big button or a large code, the address in full, and Emil signing off. One layout, so the
// seven files in supabase/templates/ are written from here and never edited by hand.
//
//   deno run -A scripts/auth-emails.ts write    rewrite supabase/templates/*.html
//   deno run -A scripts/auth-emails.ts patch    print the subjects and templates as the body of
//                                               PATCH /v1/projects/<ref>/config/auth (nothing else)
//   deno run -A scripts/auth-emails.ts confirm  print the body that turns on email confirmation
//                                               with a 6-digit code (docs/Technical/email-confirmation.md)
//
// Supabase Auth fills these in with Go's html/template, which drops every HTML comment. So there are
// no comments in the output, Outlook's conditional comments (and a VML button) included: classic
// Outlook gets the button as a coloured table cell, and only its label is pressable there.
// Each template keeps the Go variables and link shapes it had: the reset link goes to
// {{ .SiteURL }}/reset-password with the token hash in the fragment (docs/Technical/password-reset.md),
// and {{ .SiteURL }} must be https://ambernotes.app in production.

export type AuthEmail = {
  file: string;
  /// The Management API field names: mailer_subjects_<key> and mailer_templates_<key>_content.
  key: string;
  subject: string;
  preview: string;
  title: string;
  /// One sentence. {{ .Email }} and {{ .NewEmail }} are wrapped so Gmail and Apple Mail don't link them.
  line: string;
  code?: string;
  button?: { label: string; href: string };
  /// One short grey line: how long it works, and what to do if it wasn't you.
  note: string;
  /// The address for "Or open:", where the button or code has a link behind it.
  link?: string;
};

const SITE = "https://ambernotes.app";
const ASSETS = `${SITE}/email`;
const RESET = "{{ .SiteURL }}/reset-password#token_hash={{ .TokenHash }}&amp;type=recovery";
const CHANGE = "{{ .SiteURL }}/account/confirm?token_hash={{ .TokenHash }}&type=email_change";

export const EMAILS: AuthEmail[] = [
  {
    file: "recovery.html",
    key: "recovery",
    subject: "Reset your Amber Notes password",
    preview: "Choose a new password. The link works for one hour.",
    title: "Let's get you back in",
    line: "Press the button to choose a new password for {{ .Email }}.",
    button: { label: "Choose a new password", href: RESET },
    note: "The link works for one hour. Didn't ask for this? Ignore this email.",
    link: RESET,
  },
  {
    file: "magic_link.html",
    key: "magic_link",
    subject: "Your Amber Notes sign-in code",
    preview: "Your code is inside. It works for one hour.",
    title: "Here's your way in",
    line: "Type this code in Amber Notes to sign in as {{ .Email }}.",
    code: "{{ .Token }}",
    note: "The code works for one hour. Didn't ask for it? Ignore this email.",
    link: "{{ .ConfirmationURL }}",
  },
  {
    // A code, not a link: the apps ask for it right after sign-up (docs/Technical/email-confirmation.md).
    file: "confirmation.html",
    key: "confirmation",
    subject: "Confirm your email for Amber Notes",
    preview: "Your code is inside. It works for one hour.",
    title: "One quick check",
    line: "Type this code in Amber Notes to confirm that {{ .Email }} is yours.",
    code: "{{ .Token }}",
    note: "The code works for one hour. Didn't make an Amber Notes account? Ignore this email.",
  },
  {
    file: "email_change.html",
    key: "email_change",
    subject: "Confirm your new email for Amber Notes",
    preview: "Confirm the change, and you'll sign in with your new address.",
    title: "New address, same notes",
    line: "Press the button to sign in with {{ .NewEmail }} instead of {{ .Email }}.",
    button: { label: "Confirm the change", href: CHANGE },
    note: "Both addresses get this email. Didn't ask for this? Ignore it.",
    link: CHANGE,
  },
  {
    file: "invite.html",
    key: "invite",
    subject: "You're invited to Amber Notes",
    preview: "Make your account, and you're in.",
    title: "Come on in",
    line: "You're invited to make an Amber Notes account with {{ .Email }}.",
    button: { label: "Accept the invite", href: "{{ .ConfirmationURL }}" },
    note: "Not expecting this? Ignore this email.",
    link: "{{ .ConfirmationURL }}",
  },
  {
    file: "reauthentication.html",
    key: "reauthentication",
    subject: "Your Amber Notes code",
    preview: "Type the code inside to confirm it's you.",
    title: "Just checking it's you",
    line: "Type this code in Amber Notes to confirm it's you, {{ .Email }}.",
    code: "{{ .Token }}",
    note: "Didn't ask for a code? Ignore this email.",
  },
  {
    file: "password_changed.html",
    key: "password_changed_notification",
    subject: "Your Amber Notes password was changed",
    preview: "If this was you, there's nothing to do.",
    title: "Your password was changed",
    line: "If you didn't change the password for {{ .Email }}, reset it now.",
    button: { label: "Reset my password", href: `${SITE}/reset-password` },
    note: "If it was you, there's nothing to do. Questions? Just reply.",
  },
];

const SANS = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const DISPLAY = "-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'SF Mono',ui-monospace,Menlo,Consolas,'Courier New',monospace";

// The lifecycle emails' colours (the site's tokens, kept off pure white and black).
const L = { ground: "#fff4e6", page: "#fffdf9", chrome: "#f6f5f3", edge: "#ebe6df", text: "#1d1d1f", secondary: "#6e6e73",
  muted: "#74604c", link: "#a85700", cta: "#2a1d10", ctaInk: "#fff4e6", paper: "#fffaf3", paperEdge: "#f0e2cf", accent: "#e39410" };

const table = (attrs = "") => `<table role="presentation" cellpadding="0" cellspacing="0" border="0"${attrs}>`;

/// An address in the sentence, bold, inside a link with no target: Gmail and Apple Mail link bare
/// addresses themselves (in blue), but leave text that is already in a link alone.
const addresses = (s: string) =>
  s.replace(/\{\{ \.(Email|NewEmail) \}\}/g, `<a class="ink" style="color:${L.text};font-weight:600;text-decoration:none;">{{ .$1 }}</a>`);

const lineHTML = (s: string) =>
  `<p class="ink body" style="margin:0 0 20px;font-size:17px;line-height:1.5;mso-line-height-rule:exactly;color:${L.text};">${addresses(s)}</p>`;
const grey = (s: string) =>
  `<p class="sec small" style="margin:0 0 10px;font-size:14px;line-height:1.5;mso-line-height-rule:exactly;color:${L.secondary};">${s}</p>`;

/// The code, large, on its own so a long press or a double click selects all of it and nothing else.
const codeHTML = (code: string) => `${table(' width="100%" style="margin:4px 0 20px;"')}<tr>
<td class="codebox" align="center" bgcolor="${L.paper}" style="background:${L.paper};border:1px solid ${L.paperEdge};border-radius:16px;padding:18px 12px;">
<span class="ink code" style="font-family:${MONO};font-size:36px;line-height:44px;font-weight:700;letter-spacing:8px;padding-left:8px;color:${L.text};-webkit-user-select:all;user-select:all;">${code}</span>
</td></tr></table>`;

/// One big button: the colour on the cell, so classic Outlook (which ignores padding on links) still
/// draws it.
const buttonHTML = (b: { label: string; href: string }) => `${table(' width="100%" style="margin:6px 0 20px;"')}<tr>
<td class="btn" align="center" bgcolor="${L.cta}" style="background:${L.cta};border-radius:14px;">
<a href="${b.href}" target="_blank" style="display:block;padding:15px 20px;font-family:${SANS};font-size:17px;font-weight:600;line-height:22px;color:${L.ctaInk};text-decoration:none;border-radius:14px;"><span class="btn-ink" style="color:${L.ctaInk};">${b.label}</span></a>
</td></tr></table>`;

/// The link in plain text, for a mail app that drops the button.
const openHTML = (href: string) =>
  `<p class="sec small" style="margin:0 0 10px;font-size:13px;line-height:1.5;mso-line-height-rule:exactly;color:${L.secondary};word-break:break-all;overflow-wrap:anywhere;">Or open: <a class="lnk" href="${href}" style="color:${L.link};">${href}</a></p>`;

export function html(e: AuthEmail): string {
  const dot = (color: string) => `<td width="10" height="10" bgcolor="${color}" style="width:10px;height:10px;border-radius:5px;background:${color};font-size:0;line-height:0;">&nbsp;</td><td width="6" style="width:6px;font-size:0;line-height:0;">&nbsp;</td>`;
  const body = [
    lineHTML(e.line),
    e.code ? codeHTML(e.code) : "",
    e.button ? buttonHTML(e.button) : "",
    grey(e.note),
    e.link ? openHTML(e.link) : "",
].filter(Boolean).join("\n");
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${e.subject}</title>
<style>
  @media (max-width: 480px) {
    .outer { padding: 16px 8px 32px !important; }
    .pad { padding-left: 24px !important; padding-right: 24px !important; }
    .h1 { font-size: 25px !important; line-height: 1.2 !important; }
    .body { line-height: 1.6 !important; }
    .code { font-size: 32px !important; letter-spacing: 6px !important; padding-left: 6px !important; }
  }
</style>
<style>
  a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; font: inherit !important; }
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
    .btn { background: #fbeedd !important; }
    .btn-ink { color: #2e180a !important; }
    .rule { border-color: #333333 !important; }
    .codebox { background: #2a2a2a !important; border-color: #3a3a3c !important; }
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
  [data-ogsb] .codebox { background: #2a2a2a !important; }
</style>
</head>
<body class="ground" style="margin:0;padding:0;background:${L.ground};-webkit-text-size-adjust:100%;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${e.preview}${"&#847; &zwnj; ".repeat(30)}</div>
${table(` class="ground" width="100%" bgcolor="${L.ground}" style="width:100%;min-width:0;background:${L.ground};"`)}
<tr><td class="outer" align="center" style="padding:28px 12px 40px;">
${table(' width="100%" style="width:100%;max-width:520px;"')}
  <tr><td style="padding:0 4px 18px;">
    ${table()}<tr>
      <td style="padding-right:10px;">${table()}<tr><td width="28" height="28" align="center" valign="middle" bgcolor="#f0901a" style="width:28px;height:28px;background:#f0901a;border-radius:7px;text-align:center;"><img src="${ASSETS}/mark.png" width="28" height="28" alt="A" style="display:block;width:28px;height:28px;border:0;border-radius:7px;color:#fff4e6;font-family:${DISPLAY};font-size:16px;font-weight:800;line-height:28px;text-align:center;"></td></tr></table></td>
      <td class="ink" style="font-family:${DISPLAY};font-size:18px;font-weight:700;color:#2a1d10;">Amber Notes</td>
    </tr></table>
  </td></tr>
  <tr><td class="window" bgcolor="${L.page}" style="background:${L.page};border:1px solid ${L.edge};border-radius:14px;">
    ${table(' width="100%"')}
      <tr><td class="chrome" bgcolor="${L.chrome}" style="background:${L.chrome};border-bottom:1px solid ${L.edge};border-top-left-radius:14px;border-top-right-radius:14px;border-bottom-left-radius:0;border-bottom-right-radius:0;padding:11px 14px;font-family:${SANS};">
        ${table(' width="100%"')}<tr>
          <td width="70" style="width:70px;">${table()}<tr>${dot("#ff5f57")}${dot("#febc2e")}${dot("#28c840")}</tr></table></td>
          <td class="sec" align="center" style="font-size:13px;font-weight:600;color:${L.secondary};">Account</td>
          <td width="70" style="width:70px;">&nbsp;</td>
        </tr></table>
      </td></tr>
      <tr><td class="pad" style="padding:26px 32px 14px;font-family:${SANS};overflow-wrap:break-word;word-wrap:break-word;">
        <h1 class="ink h1" style="margin:0 0 16px;font-family:${DISPLAY};font-size:27px;line-height:1.2;font-weight:700;color:${L.text};">${e.title}</h1>
${body}
      </td></tr>
      <tr><td class="pad" style="padding:0 32px 26px;font-family:${SANS};">
        ${table(' width="100%"')}<tr><td class="rule" style="border-top:1px solid ${L.edge};padding-top:18px;">
          ${table()}<tr>
            <td valign="middle" style="padding-right:12px;">${table()}<tr><td width="44" height="44" align="center" valign="middle" bgcolor="#74604c" style="width:44px;height:44px;background:#74604c;border-radius:22px;text-align:center;"><img src="${ASSETS}/emil.jpg" width="44" height="44" alt="E" style="display:block;width:44px;height:44px;border:0;border-radius:22px;color:#fff4e6;font-family:${DISPLAY};font-size:19px;font-weight:700;line-height:44px;text-align:center;"></td></tr></table></td>
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
    Amber Notes, made by Emil Wagman in Sweden. <a class="foot-lnk" href="${SITE}/help" style="color:${L.link};">Help</a> &middot; <a class="foot-lnk" href="${SITE}/privacy" style="color:${L.link};">Privacy</a>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}

/// The body of PATCH /v1/projects/<ref>/config/auth: every subject and template here, nothing else.
export function patch(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of EMAILS) {
    out[`mailer_subjects_${e.key}`] = e.subject;
    out[`mailer_templates_${e.key}_content`] = html(e);
  }
  return out;
}

/// The body of PATCH /v1/projects/<ref>/config/auth that turns on email confirmation for email
/// sign-ups, with the code email. Apple and Google sign-ups arrive confirmed and skip it.
export function confirmPatch(subjectPrefix = ""): Record<string, string | number | boolean> {
  const e = EMAILS.find((x) => x.key === "confirmation")!;
  return {
    mailer_autoconfirm: false,
    mailer_otp_length: 6,
    mailer_otp_exp: 3600,
    mailer_subjects_confirmation: subjectPrefix + e.subject,
    mailer_templates_confirmation_content: html(e),
  };
}

if (import.meta.main) {
  const dir = new URL("../supabase/templates/", import.meta.url);
  if (Deno.args[0] === "write") for (const e of EMAILS) Deno.writeTextFileSync(new URL(e.file, dir), html(e));
  else if (Deno.args[0] === "patch") console.log(JSON.stringify(patch(), null, 2));
  else if (Deno.args[0] === "confirm") console.log(JSON.stringify(confirmPatch(Deno.args[1] ?? ""), null, 2));
  else throw new Error("Usage: deno run -A scripts/auth-emails.ts write|patch|confirm [subject prefix]");
}
