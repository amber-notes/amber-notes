"use client";

import { useState } from "react";
import { AIGlyph } from "@/lib/ai-glyphs";
import CopyButton from "./CopyButton";
import s from "./templates.module.css";

type Item = { client: string; name: string; prompt: string };

/// Where each AI keeps an instruction it should follow every time.
const WHERE: Record<string, string> = {
  chatgpt: "Paste it into a chat in ChatGPT with Amber Notes turned on. That chat keeps it; paste it again when you start a new one.",
  claude: "Paste it into a chat in Claude with Amber Notes turned on, or add it to a Claude project's instructions so every chat in that project starts with it.",
  "claude-code": "Paste it into Claude Code, or add it to your project's CLAUDE.md so every session knows it.",
};

/// The prompt for each AI, one tab each, with a Copy button that confirms.
export default function Instructions({ items, asks }: { items: Item[]; asks: string[] }) {
  const [on, setOn] = useState(items[0].client);
  const current = items.find((i) => i.client === on) ?? items[0];
  const differs = new Set(items.map((i) => i.prompt)).size > 1;
  const pick = (k: number) => setOn(items[(k + items.length) % items.length].client);
  return (
    <section className={s.prompt} aria-labelledby="prompt">
      <div className={s.promptHead}>
        <h2 id="prompt" className={s.promptTitle}>Tell your AI</h2>
        <div className={s.tabs} role="tablist" aria-label="AI app">
          {items.map((i, k) => (
            <button key={i.client} type="button" role="tab" id={`tab-${i.client}`} aria-controls="prompt-panel" aria-selected={i.client === current.client}
              tabIndex={i.client === current.client ? 0 : -1} className={s.tab} onClick={() => setOn(i.client)}
              onKeyDown={(e) => { if (e.key === "ArrowRight") pick(k + 1); if (e.key === "ArrowLeft") pick(k - 1); }}>
              <AIGlyph name={i.client === "chatgpt" ? "openai" : "claude"} size={14} />{i.name}
            </button>
          ))}
        </div>
      </div>
      <div className={s.promptBox} role="tabpanel" id="prompt-panel" aria-labelledby={`tab-${current.client}`}>
        <p className={s.promptText}>{highlight(current.prompt)}</p>
        <div className={s.promptFoot}>
          <p className={s.promptWhere}>{WHERE[current.client]}{differs && current.client === "claude-code" ? " This one is written for working in a code repository." : ""}</p>
          <CopyButton text={current.prompt} label="Copy prompt" className={s.copy} />
        </div>
      </div>
      <div className={s.asks}>
        <p className={s.asksLabel}>Then just talk to it</p>
        <ul>{asks.map((a) => <li key={a}>{a}</li>)}</ul>
      </div>
    </section>
  );
}

/// Tool names in the prompt stand out, so it's clear which Amber Notes tool does what.
function highlight(text: string) {
  return text.split(/(\b[a-z]+(?:_[a-z]+)+\b)/g).map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part));
}
