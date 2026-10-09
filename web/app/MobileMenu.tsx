"use client";

import { useEffect, useRef, useState } from "react";
import DownloadLink from "./DownloadLink";
import { AppleGlyph } from "./SiteChrome";
import { GitHubGlyph, useStars } from "./GitHubLink";
import { APP_STORE_LIVE, APP_STORE_URL } from "@/lib/site";

const GITHUB = "https://github.com/pinto-notes/pinto-notes";
/// As long as the sheet's exit in site.css.
const EXIT_MS = 150;

/// The pages in the menu, in the desktop header's order. `under` also marks the page current on the pages below it.
export const MENU_PAGES: { href: string; label: string; icon: () => React.ReactElement; under?: boolean; also?: string }[] = [
  { href: "/templates", label: "Templates", icon: TemplatesIcon, under: true },
  { href: "/blog", label: "Blog", icon: BlogIcon, under: true },
  { href: "/changelog", label: "Changelog", icon: ChangelogIcon },
  { href: "/help", label: "Help", icon: HelpIcon, also: "/support" },
];

/// The phone header's menu: a button that opens a sheet with everything the desktop header has:
/// the pages, GitHub with its stars, and the download (or, where the Mac download is no use, what
/// the header says there instead). A modal <dialog>, so the browser holds focus inside it.
export default function MobileMenu({ path, stars: built, appStoreLive = APP_STORE_LIVE }: { path: string; stars: number | null; appStoreLive?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const fade = useRef(0);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const stars = useStars(built);

  const show = () => {
    const d = dialog.current;
    if (!d || d.open) return;
    d.showModal();
    sheet.current?.focus(); // not a button: Safari would ring it after a tap
    document.documentElement.style.overflow = "hidden"; // the page behind doesn't scroll
    setOpen(true);
  };
  /// Fades the sheet out, then closes. `now` skips the fade: a link was followed, or motion is reduced.
  const close = (now = false) => {
    const d = dialog.current;
    if (!d?.open) return;
    if (now || matchMedia("(prefers-reduced-motion: reduce)").matches) return d.close();
    setClosing(true);
    window.clearTimeout(fade.current);
    fade.current = window.setTimeout(() => d.close(), EXIT_MS);
  };

  // Following a link closes the menu, and so does a screen that grows past the phone header.
  useEffect(() => { dialog.current?.open && dialog.current.close(); }, [path]);
  useEffect(() => {
    const wide = matchMedia("(min-width: 601px)");
    const onChange = () => { if (wide.matches && dialog.current?.open) dialog.current.close(); };
    wide.addEventListener("change", onChange);
    return () => { wide.removeEventListener("change", onChange); window.clearTimeout(fade.current); document.documentElement.style.overflow = ""; };
  }, []);

  const current = (on: boolean) => (on ? "page" : undefined);
  return (
    <>
      <button ref={trigger} type="button" className="site-menu-button" aria-label="Open menu" aria-haspopup="dialog" aria-expanded={open} aria-controls="site-menu" onClick={show}>
        <span aria-hidden="true" /><span aria-hidden="true" />
      </button>
      <dialog
        ref={dialog} id="site-menu" className="site-menu" aria-label="Menu" data-closing={closing || undefined}
        onCancel={(e) => { e.preventDefault(); close(); }}
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); close(); } }}
        onClose={() => { window.clearTimeout(fade.current); document.documentElement.style.overflow = ""; setOpen(false); setClosing(false); trigger.current?.focus(); }}
        onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      >
        <div ref={sheet} className="site-sheet" tabIndex={-1} onClick={(e) => { if ((e.target as Element).closest("a")) close(true); }}>
          <div className="site-sheet-top">
            <a className="site-brand" href="/" aria-current={current(path === "/")} aria-label="Pinto Notes home">
              <img src="/mark-256.png" alt="" width={34} height={34} />
              <span className="site-name">Pinto Notes</span>
            </a>
            <button type="button" className="site-menu-button site-menu-close" aria-label="Close menu" onClick={() => close()}>
              <span aria-hidden="true" /><span aria-hidden="true" />
            </button>
          </div>
          <nav className="site-sheet-rows" aria-label="Site menu">
            {MENU_PAGES.map(({ href, label, icon: Icon, under, also }) => (
              <a key={href} href={href} aria-current={current(path === href || path === also || (!!under && path.startsWith(`${href}/`)))}><Icon />{label}</a>
            ))}
            <a href={GITHUB} target="_blank" rel="noopener noreferrer" aria-label={stars !== null ? `GitHub, ${stars} stars` : "GitHub"}>
              <GitHubGlyph />GitHub{stars !== null && <span className="site-sheet-stars">★ {stars.toLocaleString("en")}</span>}
            </a>
          </nav>
          {/* What the desktop header ends with, as fits the visitor (lib/platform.ts marks <html>, site.css shows one). */}
          <div className="site-sheet-action">
            {/* A Mac, or a platform we can't tell: the download, as on the home page. */}
            <div className="site-sheet-for pi-apple pi-not-ios">
              {appStoreLive && <a className="site-sheet-cta" href={APP_STORE_URL} target="_blank" rel="noopener noreferrer"><AppleGlyph /> Get it for iPhone</a>}
              <DownloadLink className={appStoreLive ? "site-sheet-cta site-sheet-cta-quiet" : "site-sheet-cta"}><AppleGlyph /> Download for Mac</DownloadLink>
              {!appStoreLive && <p>iPhone · coming soon</p>}
            </div>
            {/* An iPhone: the iPhone app, or where it stands; the Mac download is a page away, not a file. */}
            <div className="site-sheet-for site-sheet-ios">
              {appStoreLive
                ? <a className="site-sheet-cta" href={APP_STORE_URL} target="_blank" rel="noopener noreferrer"><AppleGlyph /> Download for iPhone</a>
                : <p>Pinto Notes for iPhone is coming to the App Store soon.</p>}
              <a className="site-sheet-cta site-sheet-cta-quiet" href="/download"><AppleGlyph /> Download for Mac</a>
            </div>
            {/* Windows, Android and Linux: the header's own words there. */}
            <div className="site-sheet-for site-sheet-other">
              <a className="site-sheet-cta site-sheet-cta-quiet" href="/download">For iPhone and Mac</a>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}

// The menu's icons: one 24px grid, one 1.7px round line, drawn for these four pages.
const line = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

/// A note with another behind it: a note you copy.
function TemplatesIcon() {
  return <svg {...line}><rect x="3.5" y="7" width="13.5" height="13.5" rx="3.2" /><path d="M8 3.5h9.5a3 3 0 0 1 3 3V16" /><path d="M7.4 12.2h5.7M7.4 15.7h3.3" /></svg>;
}
/// A pencil.
function BlogIcon() {
  return <svg {...line}><path d="M4 20l1.1-4.6L16.4 4.1a2.2 2.2 0 0 1 3.1 0l.4.4a2.2 2.2 0 0 1 0 3.1L8.6 18.9 4 20z" /><path d="M14.4 6.1l3.5 3.5" /></svg>;
}
/// Releases down a line, newest first.
function ChangelogIcon() {
  return <svg {...line}><path d="M6 8.4v2.2M6 14.4v2.2" /><circle cx="6" cy="6" r="1.9" /><circle cx="6" cy="12.5" r="1.9" /><circle cx="6" cy="19" r="1.9" /><path d="M11.5 6h9M11.5 12.5h9M11.5 19h5.5" /></svg>;
}
/// A question.
function HelpIcon() {
  return <svg {...line}><circle cx="12" cy="12" r="8.7" /><path d="M9.5 9.6a2.6 2.6 0 1 1 3.9 2.3c-.9.5-1.4 1-1.4 2" /><path d="M12 16.9v.1" /></svg>;
}
