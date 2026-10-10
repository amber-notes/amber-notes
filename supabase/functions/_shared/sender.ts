// Who the emails are from, in one place: the account emails Supabase Auth sends
// (scripts/auth-emails.ts, scripts/auth-email-config.sh) and the emails from Emil
// (supabase/functions/lifecycle).
//
// The name is Pinto Notes. The addresses stay on ambernotes.app for now: pintonotes.com is not a
// verified sending domain in Resend yet, and mail from a domain that isn't verified is refused.
// Once pintonotes.com is verified there and receives mail (replies go to emil@), change
// SENDING_DOMAIN to "pintonotes.com", apply scripts/auth-email-config.sh again and deploy the
// lifecycle function.
export const SENDING_DOMAIN = "ambernotes.app";
export const SENDER_NAME = "Pinto Notes";
/// The account emails' sender (smtp_admin_email in Supabase Auth), and the address for questions.
export const HELLO = `hello@${SENDING_DOMAIN}`;
/// The sender of the emails from Emil, and where their replies go.
export const EMIL = `emil@${SENDING_DOMAIN}`;
/// Where mail for support arrives, and where the server writes when a person has to look at
/// something (a report of a shared page). An inbox, not a sender: pintonotes.com receives mail
/// before it can send it.
export const SUPPORT_INBOX = "hello@pintonotes.com";
