import type { Metadata } from "next";
import styles from "./home.module.css";
import Demo from "./Demo";
import { GITHUB_URL, languages, latestRelease, repoStats } from "@/lib/github";
import { latestVersion } from "@/lib/changelog";
import CopyCommand from "./CopyCommand";

const APP_STORE_LIVE = false; // Flip when the iPhone app is approved.
const APP_STORE_URL = "https://apps.apple.com/app/id6817253103";

export const metadata: Metadata = {
  title: "Amber Notes: the notes app your AI can actually use",
  description:
    "As simple as the notes app you know. ChatGPT and Claude can read and update your notes, only when you say so. Free for Mac and iPhone.",
  robots: { index: true, follow: true },
  openGraph: {
    title: "The notes app your AI can actually use",
    description: "Simple notes for Mac and iPhone that ChatGPT and Claude can read and update, with your approval. Free.",
    url: "https://amber-notes.vercel.app",
    siteName: "Amber Notes",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

const FEATURES: { icon: keyof typeof ICONS; title: string }[] = [
  { icon: "chat", title: "Works with ChatGPT and Claude" },
  { icon: "bolt", title: "Updates in a second" },
  { icon: "check", title: "Lists that tidy themselves" },
  { icon: "table", title: "Real tables" },
  { icon: "photo", title: "Photos and files" },
  { icon: "import", title: "Bring your Apple Notes" },
  { icon: "key", title: "You approve every AI" },
  { icon: "shield", title: "No ads, no tracking" },
];

const MCP_URL = "https://rodegaeruhyybqilrnpn.supabase.co/functions/v1/mcp";
const CLAUDE_CODE = `claude mcp add --scope user --transport http amber-notes ${MCP_URL} --header "Authorization: Bearer <your token>"`;
const CLIENTS = ["ChatGPT", "Claude", "Claude Code", "Codex", "Any MCP client"];
const SETUP = ["git clone https://github.com/emilwagman/amber-notes.git", "cd amber-notes", "supabase start", "xcodegen generate", "open Pane.xcodeproj"];
const LANG_COLORS: Record<string, string> = { Swift: "#f0901a", TypeScript: "#a85700", Other: "#d9c2a3" };

const rise = (i: number) => ({ style: { "--i": i } as React.CSSProperties });

export default async function Home() {
  const [stats, langs, release] = await Promise.all([repoStats(), languages(), latestRelease()]);
  const tag = release ?? (latestVersion() ? `v${latestVersion()}` : null);
  return (
    <div className={styles.main}>
      <section className={styles.hero}>
        <h1 className={`${styles.h1} rise`} {...rise(0)}>
          The notes app <mark className={styles.mark}>your AI</mark> can actually use.
        </h1>
        <p className={`${styles.lede} rise`} {...rise(1)}>
          Import your Apple Notes. Connect ChatGPT, Claude, Claude Code or Codex.
        </p>
        <div className={`${styles.ctas} rise`} {...rise(2)}>
          <a className={styles.primary} href="/download"><AppleGlyph /> Download for Mac</a>
          {APP_STORE_LIVE ? (
            <a className={styles.secondary} href={APP_STORE_URL}>Get it for iPhone</a>
          ) : (
            <span className={styles.secondary}>iPhone · coming soon</span>
          )}
        </div>
      </section>

      <div className="rise-soft" {...rise(3)}><Demo /></div>

      <section className={styles.split} aria-labelledby="ai">
        <div className={styles.splitText}>
          <h2 id="ai" className={styles.h2}>Works with the AI you already use</h2>
          <p className={styles.lede}>
            Amber Notes speaks MCP, the open standard AI apps use to reach your tools. Connect once in Settings, approve it, and your assistant can read and update your notes.
          </p>
          <ul className={styles.clients} aria-label="Works with">
            {CLIENTS.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
        <div className={styles.cmdCard}>
          <p className={styles.cmdLabel}>Claude Code, in one line</p>
          <CopyCommand command={CLAUDE_CODE} />
          <p className={styles.cmdNote}>The app gives you this with your own token filled in. ChatGPT and Claude just need the address, and ask you to approve.</p>
        </div>
      </section>

      <section className={`${styles.split} ${styles.flip}`} aria-labelledby="import">
        <div className={styles.splitText}>
          <h2 id="import" className={styles.h2}>Bring all your Apple Notes in one click</h2>
          <p className={styles.lede}>
            Pick everything, or just the notes you want. Folders, checklists and tables come along. Your Apple Notes stay untouched.
          </p>
        </div>
        <figure className={styles.shot}>
          <img src="/demo/import.webp" width={1180} height={720} alt="The Import from Apple Notes window, with twelve notes picked across Recipes, Travel and Home" loading="lazy" />
        </figure>
      </section>

      <section className={styles.features} aria-label="What you get">
        {FEATURES.map((f) => (
          <div key={f.title} className={styles.feature}>
            <span className={styles.icon} aria-hidden="true">{ICONS[f.icon]}</span>
            <h2>{f.title}</h2>
          </div>
        ))}
      </section>

      <section className={styles.open} aria-labelledby="open">
        <div className={styles.openText}>
          <h2 id="open" className={styles.h2}>Built in the open</h2>
          <p className={styles.lede}>Free and open source. Read the code, see how your notes are stored, help make it better.</p>
          <div className={styles.openCtas}>
            <a className={styles.primary} href={GITHUB_URL}>
              <GitHubMark /> View on GitHub{stats && <span className={styles.starCount}>★ {stats.stars.toLocaleString("en")}</span>}
            </a>
            <a className={styles.quiet} href={`${GITHUB_URL}/blob/main/CONTRIBUTING.md`}>How to contribute →</a>
          </div>
          <nav className={styles.helpRow} aria-label="Contribute">
            <a href={`${GITHUB_URL}/issues/new?template=bug.md`}><BugIcon /> Report a bug</a>
            <a href={`${GITHUB_URL}/issues/new?labels=idea`}><IdeaIcon /> Suggest an idea</a>
            <a href={`${GITHUB_URL}/blob/main/CONTRIBUTING.md`}><WrenchIcon /> Fix something small</a>
          </nav>
        </div>
        <div className={styles.repo}>
          <div className={styles.repoCard}>
            <div className={styles.repoName}><RepoIcon /> <span>emilwagman/<b>amber-notes</b></span><span className={styles.pill}>Public</span></div>
            <p className={styles.repoDesc}>{stats?.description ?? "Apple Notes clone with MCP support, Markdown support, and more"}</p>
            {langs.length > 0 && (
              <>
                <div className={styles.langBar} aria-hidden="true">
                  {langs.map((l) => <span key={l.name} style={{ width: `${l.percent}%`, background: LANG_COLORS[l.name] ?? "#c9a57a" }} />)}
                </div>
                <ul className={styles.langs}>
                  {langs.map((l) => (
                    <li key={l.name}><i style={{ background: LANG_COLORS[l.name] ?? "#c9a57a" }} />{l.name} <span>{l.percent.toFixed(1)}%</span></li>
                  ))}
                </ul>
              </>
            )}
            <dl className={styles.repoMeta}>
              {stats && <div><dt>Stars</dt><dd>★ {stats.stars.toLocaleString("en")}</dd></div>}
              {tag && <div><dt>Latest</dt><dd>{tag}</dd></div>}
              <div><dt>License</dt><dd>{stats?.license ?? "MIT"}</dd></div>
              {stats?.pushedAt && <div><dt>Updated</dt><dd>{ago(stats.pushedAt)}</dd></div>}
            </dl>
          </div>
          <pre className={styles.term} aria-label="Run it yourself">
            <span className={styles.termBar} aria-hidden="true"><i /><i /><i /></span>
            {SETUP.map((l) => <code key={l}><span aria-hidden="true">$ </span>{l}</code>)}
          </pre>
        </div>
      </section>

      <section className={styles.closing} aria-labelledby="closing">
        <h2 id="closing" className={styles.closingTitle}>Your notes deserve better than copy and paste.</h2>
        <p className={styles.lede}>Amber Notes is free and open source. Import your Apple Notes, connect your AI, and get back to writing.</p>
        <div className={styles.ctas}>
          <a className={styles.primary} href="/download"><AppleGlyph /> Download for Mac</a>
          {APP_STORE_LIVE ? (
            <a className={styles.outline} href={APP_STORE_URL}>Get it for iPhone</a>
          ) : (
            <span className={styles.outline}>iPhone · coming soon</span>
          )}
        </div>
        <p className={styles.fine}>Requires macOS 26. Updates install themselves.</p>
      </section>
    </div>
  );
}

/// "3 hours ago", "2 days ago": when the code last changed.
function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  const f = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (s < 3600) return f.format(-Math.max(1, Math.round(s / 60)), "minute");
  if (s < 86400) return f.format(-Math.round(s / 3600), "hour");
  return f.format(-Math.round(s / 86400), "day");
}

const li = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
function BugIcon() { return <svg {...li}><rect x="4.5" y="4.5" width="7" height="9" rx="3.5" /><path d="M6 4.5a2 2 0 0 1 4 0M2 8h2.5M11.5 8H14M2.5 12.5l2-1M13.5 12.5l-2-1M2.5 3.5l2 1.5M13.5 3.5l-2 1.5M8 7v6" /></svg>; }
function IdeaIcon() { return <svg {...li}><path d="M5.5 10.5a4.5 4.5 0 1 1 5 0V12h-5ZM6 14.5h4" /></svg>; }
function WrenchIcon() { return <svg {...li}><path d="M10 2.5a3.5 3.5 0 0 0-3.2 4.8L2.5 11.6a1.4 1.4 0 0 0 2 2l4.3-4.3A3.5 3.5 0 0 0 13.5 6l-2 .5-1.7-1.8.5-2Z" /></svg>; }
function RepoIcon() { return <svg {...li}><path d="M3.5 13V3a1 1 0 0 1 1-1h8v10h-8a1 1 0 0 0-1 1 1 1 0 0 0 1 1h8M6 12v3l1-.7 1 .7v-3" /></svg>; }

function GitHubMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function AppleGlyph() {
  return (
    <svg width="14" height="17" viewBox="0 0 15 18" aria-hidden="true" fill="currentColor">
      <path d="M12.3 9.6c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.7.8-3.4.8-.7 0-1.8-.8-2.9-.8C3.2 4.6 1.8 5.4 1 6.8c-1.6 2.8-.4 6.9 1.1 9.1.8 1.1 1.7 2.3 2.8 2.3 1.1 0 1.6-.7 2.9-.7 1.4 0 1.7.7 2.9.7 1.2 0 2-1.1 2.7-2.2.9-1.3 1.2-2.5 1.2-2.6 0 0-2.3-.9-2.3-3.8zM10.1 3c.6-.7 1-1.7.9-2.7-.9 0-1.9.6-2.5 1.3-.6.6-1.1 1.6-.9 2.6.9.1 1.9-.5 2.5-1.2z" />
    </svg>
  );
}

const s = { fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const ICONS = {
  chat: <svg viewBox="0 0 48 48" {...s}><path d="M8 12a4 4 0 0 1 4-4h24a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H20l-8 7v-7a4 4 0 0 1-4-4Z" /><circle cx="18" cy="20" r="1.6" fill="currentColor" /><circle cx="24" cy="20" r="1.6" fill="currentColor" /><circle cx="30" cy="20" r="1.6" fill="currentColor" /></svg>,
  bolt: <svg viewBox="0 0 48 48" {...s}><path d="M27 5 11 27h12l-3 16 17-23H25Z" /></svg>,
  check: <svg viewBox="0 0 48 48" {...s}><circle cx="13" cy="14" r="5" /><path d="M22 14h16M22 34h16" /><circle cx="13" cy="34" r="5" /><path d="m10.5 34 2 2 3.5-4" /></svg>,
  table: <svg viewBox="0 0 48 48" {...s}><rect x="7" y="10" width="34" height="28" rx="4" /><path d="M7 19h34M7 28h34M20 10v28" /></svg>,
  photo: <svg viewBox="0 0 48 48" {...s}><rect x="7" y="10" width="34" height="28" rx="4" /><circle cx="17" cy="19" r="3" /><path d="m7 33 10-9 8 7 5-4 11 9" /></svg>,
  import: <svg viewBox="0 0 48 48" {...s}><path d="M14 8h14l8 8v24a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z" /><path d="M24 20v14M18 28l6 6 6-6" /></svg>,
  key: <svg viewBox="0 0 48 48" {...s}><circle cx="16" cy="24" r="7" /><path d="M23 24h18M35 24v6M40 24v4" /></svg>,
  shield: <svg viewBox="0 0 48 48" {...s}><path d="M24 6 9 12v11c0 9 6.5 16 15 19 8.5-3 15-10 15-19V12Z" /><path d="m17 24 5 5 9-10" /></svg>,
};
