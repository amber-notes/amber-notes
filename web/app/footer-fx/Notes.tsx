"use client";

import { useEffect, useRef } from "react";
import { reduced } from "./shared";

type Note = { x: number; y: number; d: 0 | 1 | 2; r: number; title: string; kind: "list" | "text" | "check"; phone?: [number, number] };

// Where each note rests, in % of the footer box, with its depth (0 far, 2 near) and resting tilt.
// They keep to the sides and the band above the name, clear of the links in the middle. Phones
// show six of them, in the band above the links (`phone` is their x, y there).
const NOTES: Note[] = [
  { x: 5, y: 7, d: 0, r: -8, title: "Reading list", kind: "list" },
  { x: 19, y: 6, d: 2, r: 6, title: "Ideas", kind: "text", phone: [3, 6] },
  { x: 38, y: 9, d: 0, r: -3, title: "Journal", kind: "text" },
  { x: 56, y: 7, d: 1, r: -6, title: "Standup", kind: "list", phone: [13, 27] },
  { x: 75, y: 9, d: 0, r: 9, title: "Quotes", kind: "text" },
  { x: 86, y: 6, d: 2, r: 5, title: "Kanelbullar", kind: "text", phone: [67, 8] },
  { x: 1, y: 38, d: 2, r: -4, title: "Trip to Lisbon", kind: "text" },
  { x: 88, y: 40, d: 1, r: -7, title: "Packing", kind: "check", phone: [74, 29] },
  { x: 14, y: 57, d: 1, r: 5, title: "Groceries", kind: "check", phone: [38, 4] },
  { x: 31, y: 61, d: 0, r: -3, title: "Gift ideas", kind: "check" },
  { x: 64, y: 60, d: 0, r: 4, title: "Workout", kind: "check" },
  { x: 74, y: 54, d: 2, r: -5, title: "Garden", kind: "list", phone: [42, 22] },
];

/// D: your notes, settling. A scatter of small paper notes sits around the footer at three depths.
/// As the footer arrives the nearer ones travel further (parallax on the footer's view timeline),
/// tilting into place; while it is in view they breathe very slightly and lean with the pointer.
export default function Notes() {
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = stage.current;
    const footer = el?.closest("footer");
    if (!el || !footer || reduced()) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) el.dataset.awake = "";
      else delete el.dataset.awake;
    });
    io.observe(footer);
    let raf = 0, px = 0, py = 0;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      px = (e.clientX / innerWidth) * 2 - 1;
      py = (e.clientY / innerHeight) * 2 - 1;
      if (!raf) raf = requestAnimationFrame(() => {
        raf = 0;
        el.style.setProperty("--px", px.toFixed(3));
        el.style.setProperty("--py", py.toFixed(3));
      });
    };
    footer.addEventListener("pointermove", onMove);
    return () => { io.disconnect(); cancelAnimationFrame(raf); footer.removeEventListener("pointermove", onMove); };
  }, []);

  return (
    <div ref={stage} className="fx-notes" aria-hidden="true">
      {([0, 1, 2] as const).map((d) => (
        <div key={d} className="fx-notes-depth" data-d={d}>
          <div className="fx-notes-lean">
            {NOTES.filter((n) => n.d === d).map((n, i) => (
              <div key={n.title} className={`fx-note${n.phone ? "" : " fx-note-wide"}`} style={{ "--x": `${n.x}%`, "--y": `${n.y}%`, "--sx": `${n.phone?.[0] ?? 0}%`, "--sy": `${n.phone?.[1] ?? 0}%`, "--r": `${n.r}deg`, "--i": i } as React.CSSProperties}>
                <div className="fx-note-paper">
                  <b>{n.title}</b>
                  {n.kind === "check" ? (
                    <>
                      <i className="fx-note-tick done" /><i className="fx-note-tick" /><i className="fx-note-tick" />
                    </>
                  ) : n.kind === "list" ? (
                    <><i className="fx-note-dot" /><i className="fx-note-dot" /><i className="fx-note-dot short" /></>
                  ) : (
                    <><i className="fx-note-line" /><i className="fx-note-line" /><i className="fx-note-line short" /></>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
