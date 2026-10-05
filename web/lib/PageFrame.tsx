"use client";
import { useEffect, useRef, useState } from "react";
import { USERCONTENT } from "./collab-relay";
import { noteData } from "./note-data";

/// A note's page, read-only, on the user-content origin. The frame is sandboxed (scripts only: an
/// opaque origin, no storage, no navigation of this page) and its own CSP allows no network at all.
/// This site hands it the page and the note's data once; it can only answer with its height.
export default function PageFrame({ html, markdown, data, label, caption = true }: { html: string; markdown: string; data?: Record<string, unknown> | null; label: string; caption?: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(420);
  const [site, setSite] = useState<string | null>(null);
  useEffect(() => setSite(window.location.origin), []);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow) return;
      if (e.data?.type === "amber-page-ready") {
        ref.current?.contentWindow?.postMessage({ type: "amber-page", html, note: noteData(markdown), data: data ?? {} }, "*");
      } else if (e.data?.type === "amber-page-height" && typeof e.data.height === "number") {
        setHeight(Math.min(4000, Math.max(200, Math.ceil(e.data.height))));
      }
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, [html, markdown, data]);
  if (!site) return <div style={{ height }} />;
  return (
    <figure style={{ margin: "0 0 28px" }}>
      <iframe
        ref={ref}
        title={label}
        src={`${USERCONTENT}/frame.html?site=${encodeURIComponent(site)}`}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        loading="lazy"
        style={{ width: "100%", height, border: 0, borderRadius: 16, background: "var(--page)", display: "block", boxShadow: "0 0 0 1px var(--rule)" }}
      />
      {caption && (
        <figcaption style={{ fontSize: 13.5, color: "var(--secondary)", marginTop: 8 }}>
          Read-only. The page runs on its own site with no internet access, and nothing you tap here is saved.
        </figcaption>
      )}
    </figure>
  );
}
