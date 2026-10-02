import type { Metadata } from "next";
import { devOnly } from "@/lib/dev-only";
import { ButtonRow, Card, EmptyState, Field, Sign, Stage, ui } from "@/lib/ui";

// Dev only: the proposed landing pages for the links in account emails (docs/Technical/account-emails.md),
// drawn from fixed props with no network, for review (/dev/account?screen=confirm|confirmed|expired|
// reset|reset-error|reset-done). Nothing here is wired to Supabase, and it isn't on the production site.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dev: account email landing pages", robots: { index: false, follow: false } };

const EMAIL = "sara@example.com";
const openApp = <a className={ui.primary} href="ambernotes://">Open Amber Notes</a>;
const getApp = <p className={ui.small}>Don&apos;t have it on this device? <a href="/download">Get Amber Notes</a></p>;

export default async function AccountPreview({ searchParams }: { searchParams: Promise<{ screen?: string }> }) {
  devOnly();
  const { screen = "confirm" } = await searchParams;
  return <Stage inSite>{screens[screen] ?? screens.confirm}</Stage>;
}

const reset = (error?: string) => (
  <Card form>
    <div className={ui.group}>
      <h1 className={ui.title}>Choose a new password</h1>
      <p className={ui.lede}>For <b>{EMAIL}</b>. Your notes stay as they are: they&apos;re locked with your key, not with your password.</p>
    </div>
    <form className={ui.form}>
      <Field id="password" name="password" label="New password" type="password" autoComplete="new-password" minLength={12} required hint="At least 12 characters." />
      <Field id="again" name="again" label="Type it again" type="password" autoComplete="new-password" minLength={12} required error={error} />
      <ButtonRow><button type="button" className={ui.primary}>Save password</button></ButtonRow>
    </form>
  </Card>
);

const screens: Record<string, React.ReactNode> = {
  // The link only shows this page. Pressing the button confirms, so a mail scanner that opens the
  // link can't use it up.
  confirm: (
    <EmptyState title="Confirm your email" actions={<button type="button" className={ui.primary}>Confirm email</button>}>
      Confirm that <b>{EMAIL}</b> is yours, and your Amber Notes account is ready.
    </EmptyState>
  ),
  confirmed: (
    <EmptyState title="Your email is confirmed" sign={<Sign kind="done" />} actions={<>{openApp}{getApp}</>}>
      Go back to Amber Notes and sign in.
    </EmptyState>
  ),
  expired: (
    <EmptyState title="This link has expired" sign={<Sign kind="gone" />} actions={<a className={ui.secondary} href="ambernotes://">Open Amber Notes</a>}>
      A link in an email works once, for one hour. Ask for a new one from the sign-in screen in Amber Notes.
    </EmptyState>
  ),
  reset: reset(),
  "reset-error": reset("The two passwords aren't the same."),
  "reset-done": (
    <EmptyState title="Your password is changed" sign={<Sign kind="done" />} actions={<>{openApp}{getApp}</>}>
      Sign in to Amber Notes with your new password.
    </EmptyState>
  ),
};
