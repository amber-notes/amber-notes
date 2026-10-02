import type { Metadata } from "next";
import legal from "@/lib/legal.module.css";
import { pageMetadata } from "@/lib/site";
import { AI_ACCESS, CAVEAT, COUNTS, ENCRYPTION, FACTS, LIMITS, LOGS, PRIVACY_PATH, READABLE, WHO_CAN_SEE } from "@/lib/privacy";
import s from "./privacy.module.css";

// Privacy & Security for people, not lawyers: what we store, who can see it, which logs exist.
// The facts live in lib/privacy.ts (shared with the home page); docs/privacy-policy.md is the long form.

export const dynamic = "force-static";
export const metadata: Metadata = pageMetadata({
  title: "Privacy & Security · Amber Notes",
  description: "What Amber Notes stores and where, what's encrypted and what stays readable, what happens when you connect an AI, every log we keep and for how long.",
  path: PRIVACY_PATH,
  index: true,
});

const r = (i: number) => ({ "--i": i }) as React.CSSProperties;
const GITHUB = "https://github.com/emilwagman/amber-notes";

const Shield = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 2 3.5 4.5v5c0 4 2.8 7 6.5 8.5 3.7-1.5 6.5-4.5 6.5-8.5v-5Z" /><path d="m7 10 2 2 4-4.5" strokeLinecap="round" />
  </svg>
);

export default function PrivacySecurity() {
  return (
    <div className={legal.main}>
      <div className={legal.col}>
        <div className={`${legal.head} rise`} style={r(0)}>
          <h1 className={legal.title}>Privacy & Security</h1>
          <p className={legal.updated}>What we store, who can see it, and every log we keep. In plain words.</p>
        </div>

        <ul className={`${s.facts} rise`} style={r(1)}>
          {FACTS.map((f) => (
            <li key={f.title} className={s.fact}>
              <h2><Shield />{f.title}</h2>
              <p>{f.text}</p>
            </li>
          ))}
        </ul>

        <p className={`${s.caveat} rise`} style={r(2)}>
          {CAVEAT.text} <a href={CAVEAT.href}>{CAVEAT.link}</a>
        </p>

        <article className={`${legal.article} rise`} style={r(3)}>
          <h2 id="what-we-store">What we store, and where</h2>
          <p>
            Your account (your email address, or Apple&apos;s relay address if you use Hide My Email), your notes, folders, files and
            earlier versions of each note as encrypted copies, your profile name and photo if you set them, your devices, and the AI apps
            you&apos;ve connected. It&apos;s all stored at Supabase, our host, in Frankfurt, Germany.
          </p>
          <p>
            The website and shared note pages run on Vercel, and are built in Frankfurt too. Vercel passes requests on to our server,
            including the requests AI apps make, and sees a shared note while it shows the page, but it doesn&apos;t store your notes.
          </p>

          <h2 id="encryption">What&apos;s encrypted</h2>
          <ul>
            {ENCRYPTION.items.map((i) => <li key={i.label}><strong>{i.label}</strong> {i.text}</li>)}
          </ul>
          <p>{ENCRYPTION.note}</p>

          <h2 id="readable">What stays readable to us</h2>
          <p>To sync your notes and run your account, some details aren&apos;t encrypted:</p>
          <ul>
            {READABLE.map((t) => <li key={t}>{t.charAt(0).toUpperCase() + t.slice(1)}.</li>)}
          </ul>

          <h2 id="ai">When you connect an AI</h2>
          <ul>
            {AI_ACCESS.map((i) => <li key={i.label}><strong>{i.label}</strong> {i.text}</li>)}
            <li>You choose <strong>Read Only</strong> or <strong>Read and Edit</strong> for each one.</li>
            <li>Every change an AI makes keeps the previous version, so you can see what changed and restore it.</li>
            <li>Disconnect any AI app in <strong>Settings → Connect an AI</strong>. It loses access at once.</li>
            <li>What an AI app reads becomes part of your conversation with it, and the company behind it handles that under its own privacy policy.</li>
          </ul>

          <h2 id="limits">Limits</h2>
          <ul>
            {LIMITS.map((i) => <li key={i.label}><strong>{i.label}</strong> {i.text}</li>)}
          </ul>

          <h2 id="who-can-see">Who can see what</h2>
          <ul>
            {WHO_CAN_SEE.map((i) => <li key={i.label}><strong>{i.label}</strong> {i.text}</li>)}
          </ul>

          <h2 id="no-tracking">No ads, no tracking</h2>
          <p>
            There are no ads, and there never will be. The apps have no tracking, no third-party analytics and no crash-reporting tools.
            We never sell or share your data.
          </p>
          <p>
            This website counts page views and where visitors came from with Vercel Web Analytics, and which links and buttons are
            clicked and how far pages are scrolled with PostHog, in the EU. Neither uses cookies or keeps a profile of you, and neither
            runs on shared notes or the connect pages. It also counts Mac downloads as daily totals. None of this touches your notes or
            your computer.
          </p>
          <p>The apps count a few things on our own server, so we can tell whether Amber Notes works for people. Kept for 12 months, never shared:</p>
          <ul>
            {COUNTS.map((c) => <li key={c}>{c.charAt(0).toUpperCase() + c.slice(1)}.</li>)}
          </ul>

          <h2 id="logs">Every log, and how long it&apos;s kept</h2>
          <p>
            We don&apos;t write the text of your notes, email addresses, access tokens or IP addresses into any log of our own. Our hosts log
            the requests that reach them; we can&apos;t turn that off, but they keep it briefly.
          </p>
          <table>
            <thead><tr><th>Log</th><th>What&apos;s in it</th><th>Kept</th></tr></thead>
            <tbody>
              {LOGS.map((l) => (
                <tr key={l.name}><td>{l.name}</td><td>{l.what}</td><td className={s.kept}>{l.kept}</td></tr>
              ))}
            </tbody>
          </table>
          <p>
            Our hosting plan keeps no backups of the database, so what you delete is gone. If that changes, a backup would hold only the
            encrypted copies and the locked copies of your key, for as long as this page and the privacy policy say.
          </p>

          <h2 id="your-data">Your data, your choice</h2>
          <ul>
            <li><strong>Export:</strong> Settings → Privacy &amp; Security → Export Your Notes makes a zip on your device with every note as Markdown in its folder, with its files. We can&apos;t read your notes, so the export can only be made there. For everything else we keep about you, write to us.</li>
            <li><strong>Delete:</strong> Settings → Delete Account deletes your account and everything in it from our server at once: notes, files, versions, AI connections, share links and usage counts.</li>
            <li><strong>Deleted notes</strong> stay in Recently Deleted for 30 days, then they&apos;re gone for good.</li>
            <li>
              You can also ask us to correct, restrict or stop using your data, or object to the usage counts. Write to{" "}
              <a href="mailto:emil@norditech.se">emil@norditech.se</a>; we answer within a month. You can complain to the Swedish Authority
              for Privacy Protection (<a href="https://www.imy.se" target="_blank" rel="noopener noreferrer">IMY</a>).
            </li>
          </ul>

          <h2 id="open-source">Open source, so you can check</h2>
          <p>
            Everything above is in the code, and the code is on <a href={GITHUB} target="_blank" rel="noopener noreferrer">GitHub</a>:
            the apps, the server and this website. Found a security problem? Write to <a href="mailto:emil@norditech.se">emil@norditech.se</a>,
            not a public issue.
          </p>
          <p>The legal details are in the <a href="/privacy">privacy policy</a>.</p>
        </article>
      </div>
    </div>
  );
}
