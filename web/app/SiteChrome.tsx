"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import DownloadLink from "./DownloadLink";
import { themeFor } from "@/lib/theme";

const GITHUB = "https://github.com/emilwagman/amber-notes";
const X_URL = "https://x.com/EmilWagman";
const MAKER_URL = "https://emilwagman.com";

export default function SiteChrome({ version, stars, children }: { version: string | null; stars: number | null; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const done = useRef<(() => void) | null>(null);
  const site = themeFor(path) !== null;

  // Keep the theme in step with the page (also for back/forward), and finish a pending transition.
  useEffect(() => {
    const t = themeFor(path);
    if (t) document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    done.current?.();
    done.current = null;
  }, [path]);

  // Same-site links between site pages navigate inside a view transition.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname || !themeFor(url.pathname)) return;
      const doc = document as Document & { startViewTransition?: (cb: () => Promise<void>) => unknown };
      if (!doc.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      e.preventDefault();
      doc.startViewTransition(() => new Promise<void>((resolve) => {
        done.current = resolve;
        router.push(url.pathname + url.search + url.hash);
        window.setTimeout(resolve, 1500); // never hang if the route is slow
      }));
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [router]);

  // The consent page is one card: the site's colours without its header and footer.
  if (!site || path === "/connect") return <>{children}</>;

  const current = (href: string) => (path === href ? "page" : undefined);
  // On the home page the logo takes you back to the top instead of reloading.
  const toTop = (e: React.MouseEvent) => {
    if (path !== "/" || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  return (
    <div className="site">
      <header className="site-header">
        <a className="site-brand" href="/" aria-current={current("/")} aria-label="Amber Notes home" onClick={toTop}>
          <img src="/mark-256.png" alt="" width={34} height={34} />
          <span className="site-name">Amber Notes</span>
          {version && <span className="site-badge">v{version}</span>}
        </a>
        <nav className="site-nav" aria-label="Site">
          <a href="/blog" aria-current={path === "/blog" || path.startsWith("/blog/") ? "page" : undefined}>Blog</a>
          <a href="/changelog" aria-current={current("/changelog")}>Changelog</a>
          <a href="/help" aria-current={path === "/help" || path === "/support" ? "page" : undefined}>Help</a>
          <a className="site-gh" href={GITHUB} target="_blank" rel="noopener noreferrer" aria-label={stars !== null ? `GitHub, ${stars} stars` : "GitHub"}>
            <GitHubGlyph />{stars !== null && <span className="site-stars">★ {stars.toLocaleString("en")}</span>}
          </a>
          <DownloadLink className="site-cta" aria-current={current("/download")}>
            <AppleGlyph /> <span className="site-cta-long">Download for Mac</span><span className="site-cta-short">Download</span>
          </DownloadLink>
        </nav>
      </header>
      <main className="site-main">{children}</main>
      <footer className="site-footer">
        <div className="site-footrow">
          <nav aria-label="More">
            <a href="/blog">Blog</a>
            <a href="/changelog">Changelog</a>
            <a href="/privacy-security">Privacy & Security</a>
            <a href="/privacy">Privacy Policy</a>
            <a href="/terms">Terms</a>
            <a href="/help">Help</a>
          </nav>
          <span className="site-footsep" aria-hidden="true" />
          <div className="site-social">
            <a href={GITHUB} target="_blank" rel="noopener noreferrer" aria-label="Amber Notes on GitHub"><GitHubGlyph /></a>
            <a href={X_URL} target="_blank" rel="me noopener noreferrer" aria-label="Emil Wagman on X"><XGlyph /></a>
          </div>
        </div>
        <p className="site-credit">Made by <a className="site-maker" href={MAKER_URL} target="_blank" rel="me noopener">Emil Wagman</a> at <a className="site-maker" href="https://incredible.one" target="_blank" rel="noopener">Incredible</a>. Works with ChatGPT and Claude; not affiliated with Apple, OpenAI or Anthropic.</p>
        <svg className="site-wordmark" viewBox="0 0 1000 170" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
          <text x="500" y="160" textAnchor="middle" textLength="980" lengthAdjust="spacingAndGlyphs">Amber Notes</text>
        </svg>
      </footer>
    </div>
  );
}

export function AppleGlyph() {
  return (
    <svg width="14" height="17" viewBox="0 0 15 18" aria-hidden="true" fill="currentColor">
      <path d="M12.3 9.6c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.7.8-3.4.8-.7 0-1.8-.8-2.9-.8C3.2 4.6 1.8 5.4 1 6.8c-1.6 2.8-.4 6.9 1.1 9.1.8 1.1 1.7 2.3 2.8 2.3 1.1 0 1.6-.7 2.9-.7 1.4 0 1.7.7 2.9.7 1.2 0 2-1.1 2.7-2.2.9-1.3 1.2-2.5 1.2-2.6 0 0-2.3-.9-2.3-3.8zM10.1 3c.6-.7 1-1.7.9-2.7-.9 0-1.9.6-2.5 1.3-.6.6-1.1 1.6-.9 2.6.9.1 1.9-.5 2.5-1.2z" />
    </svg>
  );
}

function GitHubGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function XGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M18.9 1.2h3.7l-8 9.2L24 22.8h-7.4l-5.8-7.6-6.6 7.6H.5l8.6-9.8L0 1.2h7.6l5.2 6.9 6.1-6.9Zm-1.3 19.4h2L6.5 3.3H4.3Z" />
    </svg>
  );
}
