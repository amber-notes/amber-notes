import type { Metadata } from "next";
import legal from "@/lib/legal.module.css";
import { pageMetadata } from "@/lib/site";
import { COMING, COUNTS, FACTS, LOGS, PRIVACY_PATH } from "@/lib/privacy";
import s from "./privacy.module.css";

// Privacy & Security for people, not lawyers: what we store, who can see it, which logs exist.
// The facts live in lib/privacy.ts (shared with the home page); docs/privacy-policy.md is the long form.

export const dynamic = "force-static";
export const metadata: Metadata = pageMetadata({
  title: "Privacy & Security · Amber Notes",
  description: "What Amber Notes stores and where, what's encrypted, who can see your notes, every log we keep and for how long. No ads, no tracking.",
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

        <p className={`${s.coming} rise`} style={r(2)}>
          {COMING.text} <a href={COMING.href} target="_blank" rel="noopener noreferrer">Read the design</a>
        </p>

        <article className={`${legal.article} rise`} style={r(3)}>
          <h2 id="what-we-store">What we store, and where</h2>
          <p>
            Your account (your email address, or Apple&apos;s relay address if you use Hide My Email), your notes, folders, files and
            earlier versions of each note, your profile name and photo if you set them, and the AI apps you&apos;ve connected.
            It&apos;s all stored at Supabase, our host, in Frankfurt, Germany.
          </p>
          <p>
            The website and shared note pages run on Vercel, and are built in Frankfurt too. Vercel passes requests on to our server
            and sees a shared note while it shows the page, but it doesn&apos;t store your notes.
          </p>

          <h2 id="encryption">What&apos;s encrypted</h2>
          <ul>
            <li><strong>On the way:</strong> everything between the apps, the website and our server travels over HTTPS.</li>
            <li><strong>Where it&apos;s stored:</strong> Supabase encrypts the database and files on its disks (AES-256).</li>
            <li>
              <strong>Locked notes, end to end:</strong> a locked note&apos;s text is encrypted on your device with a key made from your notes
              password, before it&apos;s uploaded. We never get the password or the key. Its title stays readable so your list can show it.
              If you forget the password, nobody can recover the note.
            </li>
            <li><strong>Passwords and access tokens</strong> are stored only as one-way hashes.</li>
          </ul>
          <p>
            Notes that aren&apos;t locked are not end-to-end encrypted yet. Our server has to read them to sync them, search them and hand
            them to the AI apps you approve.
          </p>

          <h2 id="who-can-see">Who can see what</h2>
          <ul>
            <li><strong>You,</strong> on every device you sign in on.</li>
            <li>
              <strong>Us.</strong> As the people running the database (that&apos;s Emil, who makes Amber Notes), we could technically read
              notes that aren&apos;t locked. We use them only to store, sync and show them to you. Supabase could too, under its contract with us.
            </li>
            <li><strong>AI apps you approve,</strong> for the notes they ask for. They never see the text of locked notes, only their titles.</li>
            <li><strong>Anyone with the link to a note you share,</strong> until you stop sharing it. Shared pages are hidden from search engines.</li>
          </ul>

          <h2 id="no-tracking">No ads, no tracking</h2>
          <p>
            There are no ads, and there never will be. The apps and this website have no tracking scripts, no third-party analytics and no
            crash-reporting tools, and the website sets no cookies. We never sell or share your data.
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
          <p>Our hosting plan keeps no backups of the database, so what you delete is gone.</p>

          <h2 id="ai">AI connections</h2>
          <ul>
            <li>Nothing reaches an AI app unless you connect one and approve it, in Amber Notes or on this website.</li>
            <li>You choose <strong>Read Only</strong> or <strong>Read and Edit</strong> for each one.</li>
            <li>Every change an AI makes keeps the previous version, so you can see what changed and restore it.</li>
            <li>Disconnect any AI app in <strong>Settings → Connect an AI</strong>. It loses access at once.</li>
            <li>What an AI app reads becomes part of your conversation with it, and the company behind it handles that under its own privacy policy.</li>
          </ul>

          <h2 id="your-data">Your data, your choice</h2>
          <ul>
            <li><strong>Export:</strong> Settings → Privacy &amp; Security → Export My Data gives you a zip with every note as Markdown and everything else we keep about you as JSON.</li>
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
