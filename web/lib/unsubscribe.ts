/// The onboarding emails' unsubscribe link: pintonotes.com/unsubscribe?u=<account id>&t=<token>. The
/// token is an HMAC the lifecycle function checks (supabase/functions/lifecycle/logic.ts); here only
/// its shape is checked, so a mangled link says so instead of offering a button that can't work.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;

export function readUnsubscribeLink(u: string | null | undefined, t: string | null | undefined): { u: string; t: string } | null {
  const id = (u ?? "").trim().toLowerCase();
  const token = (t ?? "").trim();
  return UUID.test(id) && TOKEN.test(token) ? { u: id, t: token } : null;
}

/// Mail apps' own unsubscribe button posts "List-Unsubscribe=One-Click" (RFC 8058); the page's button
/// posts nothing.
export function isOneClick(body: string): boolean {
  return new URLSearchParams(body).get("List-Unsubscribe") === "One-Click";
}
