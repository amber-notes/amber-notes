"use client";

import { useEffect, useRef, useState } from "react";

/// Copies `text`, then says so on the button for two seconds (and to screen readers). Falls back to
/// a hidden text area where the Clipboard API isn't allowed (an http preview, an old browser).
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

/// `event` names the click for website analytics (lib/posthog.ts).
export default function CopyButton({ text, label, done = "Copied", className, event }: { text: string; label: string; done?: string; className?: string; event?: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // A new text (another AI's tab) starts fresh.
  useEffect(() => setState("idle"), [text]);

  const copy = async () => {
    const ok = await copyText(text);
    setState(ok ? "done" : "failed");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2000);
  };

  return (
    <button type="button" className={className} onClick={copy} data-done={state === "done" || undefined} data-event={event}>
      {state === "done" ? <Check /> : <CopyGlyph />}
      <span aria-live="polite">{state === "done" ? done : state === "failed" ? "Select and copy it" : label}</span>
    </button>
  );
}

const Check = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg>;
const CopyGlyph = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8.5" rx="2" /><path d="M10.5 3.5V3a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3v5.5A1.5 1.5 0 0 0 4 10h1" /></svg>;
