import { assert, assertEquals } from "jsr:@std/assert@1";
import { EMAILS, html, patch } from "./auth-emails.ts";

const dir = new URL("../supabase/templates/", import.meta.url);

Deno.test("the files in supabase/templates are what scripts/auth-emails.ts writes", () => {
  for (const e of EMAILS) assertEquals(Deno.readTextFileSync(new URL(e.file, dir)), html(e), `${e.file}: run deno run -A scripts/auth-emails.ts write`);
});

Deno.test("each email keeps its Go variables and link", () => {
  const needs: Record<string, string[]> = {
    "recovery.html": ["{{ .Email }}", "{{ .SiteURL }}/reset-password#token_hash={{ .TokenHash }}&amp;type=recovery"],
    "magic_link.html": ["{{ .Email }}", "{{ .Token }}", "{{ .ConfirmationURL }}"],
    "confirmation.html": ["{{ .Email }}", "{{ .SiteURL }}/account/confirm?token_hash={{ .TokenHash }}&type=email"],
    "email_change.html": ["{{ .Email }}", "{{ .NewEmail }}", "{{ .SiteURL }}/account/confirm?token_hash={{ .TokenHash }}&type=email_change"],
    "invite.html": ["{{ .Email }}", "{{ .ConfirmationURL }}"],
    "reauthentication.html": ["{{ .Email }}", "{{ .Token }}"],
    "password_changed.html": ["{{ .Email }}", "https://ambernotes.app/reset-password"],
  };
  for (const e of EMAILS) for (const v of needs[e.file]) assert(html(e).includes(v), `${e.file} lacks ${v}`);
});

Deno.test("only variables Supabase Auth fills in, no comments (html/template drops them) and no dashes", () => {
  const known = new Set(["SiteURL", "ConfirmationURL", "Token", "TokenHash", "Email", "NewEmail", "RedirectTo", "SendingTo", "Data"]);
  for (const [k, v] of Object.entries(patch())) {
    for (const m of v.matchAll(/\{\{\s*\.(\w+)\s*\}\}/g)) assert(known.has(m[1]), `${k}: unknown {{ .${m[1]} }}`);
    assertEquals(v.replace(/\{\{\s*\.\w+\s*\}\}/g, "").includes("{{"), false, `${k}: a template action other than a variable`);
    assertEquals(v.includes("<!--"), false, `${k}: an HTML comment`);
    assert(!/[–—]/.test(v), `${k}: a dash`);
  }
});

Deno.test("the reset email's links all go to the same reset page (scripts/password-reset-e2e.test.ts reads them)", () => {
  const recovery = html(EMAILS.find((e) => e.file === "recovery.html")!);
  const hrefs = [...recovery.matchAll(/href="([^"]+reset-password[^"]+)"/g)].map((m) => m[1]);
  assert(hrefs.length >= 2 && hrefs.every((h) => h === hrefs[0]));
});

Deno.test("supabase/config.toml has the same subjects", () => {
  const toml = Deno.readTextFileSync(new URL("../supabase/config.toml", import.meta.url));
  for (const e of EMAILS.filter((e) => !e.key.endsWith("_notification"))) {
    assert(toml.includes(`[auth.email.template.${e.key}]\nsubject = "${e.subject}"\ncontent_path = "./supabase/templates/${e.file}"`), e.key);
  }
});
