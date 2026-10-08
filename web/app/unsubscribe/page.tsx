import type { Metadata } from "next";
import Link from "next/link";
import { readUnsubscribeLink } from "@/lib/unsubscribe";
import { ButtonRow, EmptyState, Foot, Shell, Sign, Stage, TopBar, ui } from "@/lib/ui";

// Where "Stop these emails" in an onboarding email lands (supabase/functions/lifecycle). Opening the
// link changes nothing, because mail scanners open links: the button does it, by posting to
// /unsubscribe/confirm, which mail apps' own unsubscribe buttons post to as well (RFC 8058).
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Stop these emails · Pinto Notes", robots: { index: false, follow: false } };

type Search = Record<string, string | string[] | undefined>;

export default async function Unsubscribe({ searchParams }: { searchParams: Promise<Search> }) {
  const raw = await searchParams;
  const one = (k: string) => (typeof raw[k] === "string" ? raw[k] as string : undefined);
  const link = readUnsubscribeLink(one("u"), one("t"));
  const done = one("done") === "1";
  const failed = one("failed") === "1";
  return (
    <Shell>
      <TopBar />
      <Stage>
        {done ? (
          <EmptyState title="You won't get these emails again" sign={<Sign kind="done" />}
            actions={<ButtonRow><Link className={ui.secondary} href="/">Go to the home page</Link></ButtonRow>}>
            <span role="status">Your notes and your account stay as they are. Emails about your account, like a password reset, still arrive.</span>
          </EmptyState>
        ) : !link ? (
          <EmptyState title="This link isn't complete" sign={<Sign kind="gone" />}>
            Open the link from the email again, or write to hello@ambernotes.app and I&apos;ll stop the emails for you.
          </EmptyState>
        ) : (
          <EmptyState title="Stop these emails?"
            actions={
              <form method="post" action={`/unsubscribe/confirm?u=${link.u}&t=${link.t}`}>
                <ButtonRow><button type="submit" className={ui.primary}>Stop these emails</button></ButtonRow>
              </form>
            }>
            {failed
              ? <span role="status">That didn&apos;t go through. Try again in a moment, or write to hello@ambernotes.app.</span>
              : "No more tips and check-ins from Emil about getting started with Pinto Notes. Emails about your account, like a password reset, still arrive."}
          </EmptyState>
        )}
      </Stage>
      <Foot>
        <Link href="/privacy">Privacy</Link>
        <Link href="/help">Help</Link>
      </Foot>
    </Shell>
  );
}
