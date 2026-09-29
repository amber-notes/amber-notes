"use client";

// Review only (?ai=1..3): classic "works with" graphics built from app-icon tiles. Complete at rest.

import { AIGlyph } from "@/lib/ai-glyphs";
import t from "./aitiles.module.css";

type Tile = { name: string; kind: string; bg: string; fg: string; glyph?: "openai" | "claude"; badge?: boolean; ring?: boolean };
const TILES: Tile[] = [
  { name: "ChatGPT", kind: "Chat", bg: "#0d0d0d", fg: "#ffffff", glyph: "openai" },
  { name: "Claude", kind: "Chat", bg: "#d97757", fg: "#fffaf3", glyph: "claude" },
  { name: "Claude Code", kind: "Terminal", bg: "#1f1a16", fg: "#d97757", glyph: "claude", badge: true },
  { name: "Codex", kind: "Terminal", bg: "#f3f1ee", fg: "#0d0d0d", glyph: "openai", badge: true },
  { name: "Any MCP app", kind: "Any client", bg: "#fffaf3", fg: "#a85700", ring: true },
];

function Icon({ tile, size }: { tile: Tile; size: number }) {
  return (
    <span className={t.icon} data-ring={tile.ring || undefined} style={{ width: size, height: size, background: tile.bg, color: tile.fg, borderRadius: size * 0.225 }} aria-hidden="true">
      {tile.glyph ? <AIGlyph name={tile.glyph} size={Math.round(size * 0.5)} /> : <b className={t.mcp} style={{ fontSize: size * 0.2 }}>MCP</b>}
      {tile.badge && <span className={t.badge} style={{ fontSize: size * 0.14 }}>&gt;_</span>}
    </span>
  );
}
const Amber = ({ size }: { size: number }) => <img className={t.amber} src="/mark-256.png" alt="Amber Notes" width={size} height={size} style={{ borderRadius: size * 0.225 }} />;

const HEAD = (
  <div className={t.head}>
    <h2 id="ai" className={t.h2}>Works with the AI you already use</h2>
    <p className={t.lede}>Connect ChatGPT, Claude, Claude Code, Codex or any app that supports MCP. You approve each one.</p>
  </div>
);

export default function AiTiles({ option }: { option: 1 | 2 | 3 }) {
  if (option === 1) {
    return (
      <section className={t.section} aria-labelledby="ai">
        {HEAD}
        <div className={t.row}>
          <div className={t.hub}><Amber size={116} /><span>Amber Notes</span></div>
          <span className={t.link} aria-hidden="true"><i /><i /><i /></span>
          <ul className={t.tiles} aria-label="Works with">
            {TILES.map((x) => <li key={x.name}><Icon tile={x} size={92} /><span>{x.name}</span></li>)}
          </ul>
        </div>
      </section>
    );
  }
  if (option === 2) {
    return (
      <section className={`${t.section} ${t.centred}`} aria-labelledby="ai">
        {HEAD}
        <div className={t.orbit}>
          <svg className={t.rings} viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="36" /><circle cx="50" cy="50" r="22" /></svg>
          <div className={t.core}><Amber size={132} /></div>
          <ul aria-label="Works with">
            {TILES.map((x, k) => {
              const a = (-90 + k * 72) * (Math.PI / 180);
              return (
                <li key={x.name} style={{ left: `${50 + 36 * Math.cos(a)}%`, top: `${50 + 36 * Math.sin(a)}%`, "--d": `${k * -1.3}s` } as React.CSSProperties}>
                  <Icon tile={x} size={84} /><span>{x.name}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    );
  }
  return (
    <section className={`${t.section} ${t.split}`} aria-labelledby="ai">
      {HEAD}
      <ul className={t.grid} aria-label="Works with">
        {TILES.map((x) => (
          <li key={x.name}><Icon tile={x} size={56} /><span><b>{x.name}</b><small>{x.kind}</small></span></li>
        ))}
        <li className={t.gridAmber}><Amber size={56} /><span><b>Amber Notes</b><small>Your notes, for all of them</small></span></li>
      </ul>
    </section>
  );
}
