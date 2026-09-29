import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sendReport, type ReportOutcome } from "@/lib/report";
import { validSlug } from "@/lib/shared";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Report a page · Amber Notes" };

const MESSAGES: Record<ReportOutcome, { title: string; text: string; again?: boolean }> = {
  received: { title: "Thanks, we got your report", text: "We review reports within 24 hours and take down pages that break the terms of use." },
  taken_down: { title: "Thanks, the page is down for review", text: "Several people reported this page, so it's been taken down while we review it." },
  not_found: { title: "This page isn't shared any more", text: "Its owner stopped sharing it, or it was already taken down." },
  too_many: { title: "Too many reports", text: "You've sent several reports in a short time. Try again in an hour, or write to emil@norditech.se.", again: true },
  missing_reason: { title: "Say what's wrong", text: "Write a few words about the problem, then send the report.", again: true },
  error: { title: "The report didn't go through", text: "Try again in a moment, or write to emil@norditech.se with the page's address.", again: true },
};

export default async function Report({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sent?: string }>;
}) {
  const { slug } = await params;
  const { sent } = await searchParams;
  if (!validSlug(slug)) notFound();
  const outcome = sent && sent in MESSAGES ? MESSAGES[sent as ReportOutcome] : null;
  return (
    <div className="shell">
      <header className="bar">
        <Link href={`/n/${slug}`} className="brand" aria-label="Amber Notes">
          <img src="/mark.png" alt="" width={22} height={22} />
          <span>Amber Notes</span>
        </Link>
      </header>
      <main className="page">
        {outcome && (
          <div className={`notice${outcome.again ? " notice-warn" : ""}`} role="status">
            <h1 className="title">{outcome.title}</h1>
            <p className="lede">{outcome.text}</p>
          </div>
        )}
        {(!outcome || outcome.again) && (
          <>
            {!outcome && <h1 className="title">Report this page</h1>}
            {!outcome && (
              <p className="lede">
                Tell us what's wrong with this shared note. Pages that break the <Link href="/terms">terms of use</Link> are taken down.
              </p>
            )}
            <form className="report" action={sendReport}>
              <input type="hidden" name="slug" value={slug} />
              <label className="field">
                <span>What's wrong?</span>
                <textarea name="reason" required maxLength={1000} rows={5} placeholder="For example: it contains someone's private information." />
              </label>
              <label className="field">
                <span>Your email <span className="optional">(optional, if you want a reply)</span></span>
                <input type="email" name="contact" maxLength={200} autoComplete="email" />
              </label>
              <button type="submit" className="button">Send Report</button>
            </form>
          </>
        )}
        {outcome && !outcome.again && <p><Link href="/">Done</Link></p>}
      </main>
      <footer className="foot">
        <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link> · <Link href="/support">Support</Link>
      </footer>
    </div>
  );
}
