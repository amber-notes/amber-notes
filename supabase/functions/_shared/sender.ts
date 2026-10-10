// Who the emails are from, in one place: the account emails Supabase Auth sends
// (scripts/auth-emails.ts, scripts/auth-email-config.sh) and the emails from Emil
// (supabase/functions/lifecycle).
//
// The name is Pinto Notes and the addresses are on pintonotes.com, a verified sending domain in
// Resend since 10 October 2026. Mail to the old ambernotes.app addresses still arrives.
export const SENDING_DOMAIN = "pintonotes.com";
export const SENDER_NAME = "Pinto Notes";
/// The account emails' sender (smtp_admin_email in Supabase Auth), and the address for questions.
export const HELLO = `hello@${SENDING_DOMAIN}`;
/// The sender of the emails from Emil, and where their replies go.
export const EMIL = `emil@${SENDING_DOMAIN}`;
/// Where mail for support arrives, and where the server writes when a person has to look at
/// something (a report of a shared page).
export const SUPPORT_INBOX = "hello@pintonotes.com";
