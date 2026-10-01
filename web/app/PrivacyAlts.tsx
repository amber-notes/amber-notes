"use client";

// Design alternatives for the home page's "Private by design" section, picked with ?privacy=a|b|c|d.
// All copy comes from lib/privacy.ts, so none of them can claim more than the Privacy & Security page.

import { useEffect, useRef, useState } from "react";
import { CAVEAT, FACTS, HOME_ALTS, PRIVACY_PATH, READABLE } from "@/lib/privacy";
import p from "./privacy-alts.module.css";

const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function useFirstView<T extends HTMLElement>(threshold = 0.45) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, seen] as const;
}

/* ───────────── Icons, one per fact ───────────── */

const svg = { width: 18, height: 18, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
const LockIcon = () => <svg {...svg}><rect x="4" y="9" width="12" height="8.5" rx="2.2" /><path d="M6.8 9V6.6a3.2 3.2 0 0 1 6.4 0V9" /></svg>;
const CheckPhone = () => <svg {...svg}><rect x="5.5" y="2.5" width="9" height="15" rx="2.2" /><path d="m7.8 10.2 1.6 1.6 3-3.3" /></svg>;
const NoEye = () => <svg {...svg}><path d="M2.5 10s2.7-5 7.5-5 7.5 5 7.5 5-2.7 5-7.5 5-7.5-5-7.5-5Z" /><circle cx="10" cy="10" r="2.2" /><path d="m3.5 16.5 13-13" /></svg>;
const Pin = () => <svg {...svg}><path d="M10 17.5s5.5-5 5.5-9.3a5.5 5.5 0 0 0-11 0c0 4.3 5.5 9.3 5.5 9.3Z" /><circle cx="10" cy="8.2" r="1.9" /></svg>;
const Eye = () => <svg {...svg}><path d="M2.5 10s2.7-5 7.5-5 7.5 5 7.5 5-2.7 5-7.5 5-7.5-5-7.5-5Z" /><circle cx="10" cy="10" r="2.2" /></svg>;
const Arrow = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg>;
const FACT_ICONS = [LockIcon, CheckPhone, NoEye, Pin];

/// Stand-in ciphertext: as long as the text, with no word breaks left, and the same on the server and in the browser.
function cipher(text: string, seed = 7) {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let h = (seed * 2654435761) >>> 0;
  return [...text].map((ch, i) => {
    h = Math.imul(h ^ (ch.charCodeAt(0) + i), 2246822507) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    return abc[h % 64];
  }).join("");
}

function MoreLink({ dark }: { dark?: boolean }) {
  return (
    <p className={`${p.more} ${dark ? p.moreDark : ""}`}>
      <a href={PRIVACY_PATH}>Read what we store, and every log we <span className={p.nowrap}>keep<Arrow /></span></a>
      <a href={`${PRIVACY_PATH}${CAVEAT.href}`}>{CAVEAT.link}</a>
    </p>
  );
}

/* ───────────── A. The vault: one dark card, one sentence ───────────── */

export function VaultCard() {
  const v = HOME_ALTS.vault;
  const [ref, seen] = useFirstView<HTMLElement>();
  const [shut, setShut] = useState(true); // complete at rest
  useEffect(() => {
    if (!seen || reduce()) return;
    setShut(false);
    const t = window.setTimeout(() => setShut(true), 450);
    return () => clearTimeout(t);
  }, [seen]);
  return (
    <section ref={ref} className={p.vault} aria-labelledby="privacy">
      <div className={p.vaultText}>
        <p className={p.eyebrow}><LockIcon /> {v.eyebrow}</p>
        <h2 id="privacy" className={p.vaultTitle}>{v.title}</h2>
        <p className={p.vaultLede}>{v.text}</p>
        <ul className={p.chips}>
          {FACTS.map((f, i) => { const I = FACT_ICONS[i]; return <li key={f.title}><I />{f.title}</li>; })}
        </ul>
        <p className={p.vaultFine}>{v.caveat}</p>
        <MoreLink dark />
      </div>
      <div className={p.vaultArt} aria-hidden="true">
        <div className={p.cipherWall}>
          {Array.from({ length: 9 }, (_, i) => <p key={i}>{cipher("Lisbon, 4 days in May. Day 3: Sintra. Dinner at Trindade. Pack light.", i + 3)}</p>)}
        </div>
        <svg className={p.bigLock} data-shut={shut || undefined} viewBox="0 0 160 190">
          <path className={p.shackle} d="M44 86V58a36 36 0 0 1 72 0v28" fill="none" strokeWidth="16" strokeLinecap="round" />
          <rect x="18" y="80" width="124" height="100" rx="28" className={p.body} />
          <circle cx="80" cy="122" r="11" className={p.hole} />
          <rect x="75" y="126" width="10" height="26" rx="5" className={p.hole} />
        </svg>
      </div>
    </section>
  );
}

/* ───────────── B. The approval, as it really looks ───────────── */

export function ApprovalCard() {
  const b = HOME_ALTS.approval;
  return (
    <section className={p.section} aria-labelledby="privacy">
      <div className={p.head}>
        <p className={p.kicker}>Private by design</p>
        <h2 id="privacy" className={p.h2}>{b.title}</h2>
        <p className={p.lede}>{b.lede}</p>
      </div>
      <div className={p.approval}>
        <figure className={p.shot}>
          <img src="/blog/consent-e2ee.webp" alt={b.shotAlt} width={840} height={712} loading="lazy" />
        </figure>
        <ol className={p.steps}>
          {b.steps.map((s, i) => (
            <li key={s.title}>
              <span className={p.stepNum}>{i + 1}</span>
              <div>
                <b>{s.title}</b>
                <span>{s.text}</span>
                {i === 0 && <span className={p.numberChip} aria-hidden="true"><i>47</i>Type this number on your device</span>}
              </div>
            </li>
          ))}
        </ol>
      </div>
      <ul className={p.factRow}>
        {FACTS.filter((_, i) => i !== 1).map((f) => {
          const I = FACT_ICONS[FACTS.indexOf(f)];
          return <li key={f.title}><I /><b>{f.title}</b></li>;
        })}
        <li className={p.factLink}><MoreLink /></li>
      </ul>
    </section>
  );
}

/* ───────────── C. What we can see, and what we can't ───────────── */

export function LedgerCard() {
  const c = HOME_ALTS.ledger;
  return (
    <section className={p.section} aria-labelledby="privacy">
      <div className={p.head}>
        <h2 id="privacy" className={p.h2}>Private by design</h2>
        <p className={p.lede}>What we can read, and what we can't, side by side.</p>
      </div>
      <div className={p.ledger}>
        <div className={p.sealed}>
          <p className={p.paneTitle}><LockIcon /> {c.hidden}</p>
          <ul className={p.sealedList}>
            {c.hiddenItems.map((t, i) => (
              <li key={t}><b>{t}</b><span aria-hidden="true">{cipher("x".repeat(26 + (i % 3) * 5), i + 11)}</span></li>
            ))}
          </ul>
          <p className={p.sealedNote}>{c.lockedNote}</p>
        </div>
        <div className={p.open}>
          <p className={p.paneTitle}><Eye /> {c.readable}</p>
          <ul className={p.openList}>
            {READABLE.map((t) => <li key={t}>{t.replace(/ listed below$/, "")}</li>)}
          </ul>
        </div>
      </div>
      <div className={p.ledgerFoot}>
        <p>{CAVEAT.text}</p>
        <ul className={p.factRow}>
          {FACTS.slice(2).map((f, i) => { const I = FACT_ICONS[i + 2]; return <li key={f.title}><I /><b>{f.title}</b></li>; })}
        </ul>
        <MoreLink />
      </div>
    </section>
  );
}

/* ───────────── D. One note, two ways ───────────── */

const NOTE = {
  title: "Lisbon, 4 days in May",
  folder: "Travel",
  lines: ["Day 1: Alfama and the castle", "Day 2: Belém, pastéis de nata", "Day 3: Day trip to Sintra", "Dinner: Cervejaria Trindade"],
};

export function TwoViewsCard() {
  const d = HOME_ALTS.twoViews;
  const [ref, seen] = useFirstView<HTMLElement>(0.5);
  const [view, setView] = useState<"you" | "server">("server"); // complete at rest
  const [mix, setMix] = useState(1); // 0 = plain, 1 = all cipher
  const auto = useRef(true);
  useEffect(() => {
    if (!seen || reduce()) return;
    setView("you"); setMix(0);
    const t = window.setTimeout(() => { if (auto.current) show("server"); }, 1400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen]);

  const raf = useRef(0);
  function show(next: "you" | "server") {
    setView(next);
    cancelAnimationFrame(raf.current);
    if (reduce()) { setMix(next === "server" ? 1 : 0); return; }
    const from = next === "server" ? 0 : 1, to = 1 - from;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const t = Math.min(1, (now - start) / 650);
      setMix(from + (to - from) * t);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // Characters turn to cipher left to right, line by line, as `mix` goes from 0 to 1.
  const all = [NOTE.title, NOTE.folder, ...NOTE.lines];
  const total = all.reduce((s, t) => s + t.length, 0);
  let offset = 0;
  const shown = all.map((t, k) => {
    const c = cipher(t, k + 21);
    const cut = Math.round(Math.max(0, Math.min(t.length, mix * total * 1.15 - offset * 0.9)));
    offset += t.length;
    return c.slice(0, cut) + t.slice(cut);
  });
  const [title, folder, ...lines] = shown;
  const server = view === "server";

  return (
    <section ref={ref} className={p.section} aria-labelledby="privacy">
      <div className={p.head}>
        <h2 id="privacy" className={p.h2}>Private by design</h2>
        <p className={p.lede}>One note, as you see it and as our server keeps it.</p>
      </div>
      <div className={p.views}>
        <div className={p.viewStage}>
          <div className={p.segmented} role="group" aria-label="Show the note">
            <button type="button" aria-pressed={!server} onClick={() => { auto.current = false; show("you"); }}>{d.you}</button>
            <button type="button" aria-pressed={server} onClick={() => { auto.current = false; show("server"); }}>{d.server}</button>
            <i className={p.segThumb} data-right={server || undefined} aria-hidden="true" />
          </div>
          <article className={p.note} data-server={server || undefined} aria-label={server ? d.serverCaption : d.youCaption}>
            <header className={p.noteMeta} aria-hidden="true">
              <span className={p.metaFolder}>{folder}</span>
              <span className={p.metaRight}>
                <span className={p.tag}>Pinned</span>
                <span className={p.tag}>Edited by ChatGPT</span>
                <span className={p.tag}>12 May · 2.1 KB</span>
              </span>
            </header>
            <h3 className={p.noteTitle} aria-hidden="true">{title}</h3>
            <ul className={p.noteLines} aria-hidden="true">
              {lines.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
            <p className={p.readableKey} aria-hidden="true"><span className={p.tagDot} /> {d.readableTag}</p>
          </article>
          <p className={p.viewCaption} aria-live="polite">{server ? d.serverCaption : d.youCaption}</p>
        </div>
        <ul className={p.viewFacts}>
          {FACTS.map((f, i) => { const I = FACT_ICONS[i]; return <li key={f.title}><I /><div><b>{f.title}</b></div></li>; })}
          <li className={p.factLink}><MoreLink /></li>
        </ul>
      </div>
    </section>
  );
}
