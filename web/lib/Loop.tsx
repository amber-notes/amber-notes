"use client";

import { useEffect, useRef, useState } from "react";
import s from "./post-parts.module.css";

/// A few seconds of the real app, looping and muted, like a GIF but a fraction of the size. Nothing
/// downloads until it's near the screen, and it plays only while it's on screen. With Reduce Motion
/// on it shows its first frame and waits for Play. The poster has the video's own size, so nothing
/// moves when it starts.
export function Loop({ src, poster, width, height, label, caption }: { src: string; poster: string; width: number; height: number; label: string; caption?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const seen = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !still && !video.dataset.held) {
        video.preload = "auto";
        video.play().catch(() => { /* the browser wants a tap first */ });
      } else if (!e.isIntersecting) video.pause();
    }, { rootMargin: "200px 0px" });
    seen.observe(video);
    return () => seen.disconnect();
  }, []);

  const toggle = () => {
    const video = ref.current;
    if (!video) return;
    // Paused by hand, it stays paused when it scrolls back into view, until Play.
    if (video.paused) { delete video.dataset.held; video.play().catch(() => {}); }
    else { video.dataset.held = "1"; video.pause(); }
  };

  return (
    <figure className={s.loop}>
      <div className={s.loopStage}>
        <div className={s.loopFrame} style={{ "--w": `${width / 2}px` } as React.CSSProperties}>
          <video ref={ref} src={src} poster={poster} width={width} height={height} muted loop playsInline preload="none"
            aria-label={label} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
          <button type="button" className={s.loopToggle} onClick={toggle} aria-label={playing ? "Pause the clip" : "Play the clip"}>
            {playing ? "Pause" : "Play"}
          </button>
        </div>
      </div>
      {caption && <figcaption className={s.loopCaption}>{caption}</figcaption>}
    </figure>
  );
}
