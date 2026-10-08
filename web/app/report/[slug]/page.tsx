import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sendReport, type ReportOutcome } from "@/lib/report";
import { validSlug } from "@/lib/shared";
import { ButtonRow, Card, EmptyState, Field, Foot, Shell, Sign, Stage, Status, TopBar, ui } from "@/lib/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Report a page · Pinto Notes" };

const MESSAGES: Record<ReportOutcome, { title: string; text: string; again?: boolean }> = {
  received: { title: "Thanks, we got your report", text: "We review reports within 24 hours and take down pages that break the terms of use." },
  taken_down: { title: "Thanks, the page is down for review", text: "Several people reported this page, so it's been taken down while we review it." },
  not_found: { title: "This page isn't shared any more", text: "Its owner stopped sharing it, or it was already taken down." },
  too_many: { title: "Too many reports", text: "You've sent several reports in a short time. Try again in an hour, or write to hello@ambernotes.app.", again: true },
  missing_reason: { title: "Say what's wrong", text: "Write a few words about the problem, then send the report.", again: true },
  error: { title: "The report didn't go through", text: "Try again in a moment, or write to hello@ambernotes.app with the page's address.", again: true },
};

export default async function Report({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sent?: string }>;
}) {
  const { slug } = await params;
  const { sent } = await searchParams;
  if (!validSlug(slug)) notFound();
  const outcome = sent && sent in MESSAGES ? MESSAGES[sent as ReportOutcome] : null;
  // A report with nothing written is said under the field it's about; the other two that ask for
  // another try are said above the form.
  const noReason = sent === "missing_reason";
  return (
    <Shell>
      <TopBar href={`/n/${slug}`} />
      <Stage>
        {outcome && !outcome.again ? (
          <EmptyState
            title={outcome.title}
            sign={<Sign kind={sent === "not_found" ? "gone" : "done"} />}
            actions={<Link className={ui.secondary} href="/">Go to the home page</Link>}
          >
            <span role="status">{outcome.text}</span>
          </EmptyState>
        ) : (
          <Card form wide>
            <div className={ui.group}>
              <h1 className={ui.title}>Report this page</h1>
              <p className={ui.lede}>
                Tell us what's wrong with this shared note. Pages that break the <Link href="/terms">terms of use</Link> are taken down.
              </p>
            </div>
            {outcome && !noReason && <Status title={outcome.title} tone="warn">{outcome.text}</Status>}
            <form className={ui.form} action={sendReport}>
              <input type="hidden" name="slug" value={slug} />
              <Field
                multiline id="reason" name="reason" label="What's wrong?" required maxLength={1000} rows={5}
                placeholder="For example: it contains someone's private information."
                error={noReason && outcome ? `${outcome.title}. ${outcome.text}` : undefined}
              />
              <Field id="contact" name="contact" label="Your email" optional="(optional, if you want a reply)" type="email" maxLength={200} autoComplete="email" />
              <ButtonRow>
                <button type="submit" className={ui.primary}>Send report</button>
                <Link className={ui.quiet} href={`/n/${slug}`}>Go back to the note</Link>
              </ButtonRow>
            </form>
          </Card>
        )}
      </Stage>
      <Foot>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/support">Support</Link>
      </Foot>
    </Shell>
  );
}
