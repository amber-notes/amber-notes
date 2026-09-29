import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";

/// Share cards (1200 × 630) in the site's own look: the page theme's colours, the app icon and name,
/// a headline with the amber marker, and a real capture of the app on the right. Rendered at build.
/// Inter (SIL Open Font License, Inter-OFL.txt) stands in for SF Pro, which can't be bundled.

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const THEMES = {
  cream: { bg: "#fff4e6", ink: "#2a1d10", muted: "#74604c", mark: "rgba(240, 144, 26, 0.38)", chip: "#f7e5cc", shadow: "rgba(60, 20, 0, 0.5)" },
  leaf: { bg: "#2e180a", ink: "#fbeedd", muted: "#d9bf9f", mark: "rgba(245, 165, 58, 0.34)", chip: "#40240f", shadow: "rgba(0, 0, 0, 0.55)" },
};

const here = (f: string) => path.join(process.cwd(), "lib", "og", f);
const file = (f: string) => fs.readFileSync(here(f));
const dataUrl = (p: string, type: string) => `data:${type};base64,${fs.readFileSync(p).toString("base64")}`;

type Card = {
  theme: keyof typeof THEMES;
  /// The headline, with the words to mark between [ and ].
  title: string;
  sub: string;
  /// Small labels under the sub line.
  chips?: string[];
  /// The iPhone capture, or the big app icon.
  art: "phone" | "icon";
  titleSize?: number;
};

export function renderCard({ theme, title, sub, chips = [], art, titleSize = 74 }: Card) {
  const t = THEMES[theme];
  const mark = dataUrl(path.join(process.cwd(), "public", "mark.png"), "image/png");
  // Words wrap one by one; the marked phrase stays together, like "your AI" on the site, and "|" breaks the line.
  const words = title.split(/(\[[^\]]+\]\S*|\|)/).filter(Boolean).flatMap((p) => (p.startsWith("[") || p === "|" ? [p] : p.trim().split(/\s+/).filter(Boolean)));
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: t.bg, position: "relative", overflow: "hidden", fontFamily: "Inter" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 0 64px 72px", width: art === "phone" ? 780 : 760 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <img src={mark} width={64} height={64} style={{ borderRadius: 15, boxShadow: "0 2px 6px rgba(60,30,5,0.18)" }} />
            <div style={{ fontSize: 32, fontWeight: 800, color: t.ink, letterSpacing: -0.6 }}>Amber Notes</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div style={{ display: "flex", flexWrap: "wrap", fontSize: titleSize, fontWeight: 800, lineHeight: 1.02, letterSpacing: -titleSize * 0.042, color: t.ink }}>
              {words.map((w, i) => {
                if (w === "|") return <div key={i} style={{ width: "100%", height: 0 }} />;
                const m = w.match(/^\[([^\]]+)\](.*)$/);
                if (!m) return <span key={i} style={{ marginRight: titleSize * 0.26 }}>{w}</span>;
                return (
                  <span key={i} style={{ display: "flex", marginRight: titleSize * 0.26 }}>
                    <span style={{ backgroundImage: `linear-gradient(transparent 52%, ${t.mark} 52%, ${t.mark} 88%, transparent 88%)`, padding: "0 6px", margin: "0 -6px" }}>{m[1]}</span>
                    {m[2] && <span style={{ marginLeft: 6 }}>{m[2]}</span>}
                  </span>
                );
              })}
            </div>
            <div style={{ fontSize: 27, lineHeight: 1.38, color: t.muted, fontWeight: 600, maxWidth: 680 }}>{sub}</div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {chips.map((c) => (
              <div key={c} style={{ display: "flex", fontSize: 21, fontWeight: 600, color: t.ink, background: t.chip, borderRadius: 12, padding: "8px 16px" }}>{c}</div>
            ))}
          </div>
        </div>

        {art === "phone" ? (
          // The iPhone capture in a dark body, running off the bottom edge.
          <div style={{ position: "absolute", right: 64, top: 58, display: "flex", width: 330, height: 700, borderRadius: 56, background: "#17120d", padding: 11, boxShadow: "0 30px 60px -18px rgba(60,20,0,0.45)" }}>
            <img src={dataUrl(here("iphone-lisbon.png"), "image/png")} width={308} height={670} style={{ borderRadius: 46 }} />
          </div>
        ) : (
          <div style={{ position: "absolute", right: 90, top: 150, display: "flex" }}>
            <img src={mark} width={330} height={330} style={{ borderRadius: 74, boxShadow: `0 36px 70px -20px ${t.shadow}` }} />
          </div>
        )}
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Inter", data: file("Inter-SemiBold.ttf"), weight: 600, style: "normal" },
        { name: "Inter", data: file("Inter-ExtraBold.ttf"), weight: 800, style: "normal" },
      ],
    },
  );
}
