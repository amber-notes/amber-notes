"use client";

import { useState } from "react";
import CopyButton from "./CopyButton";
import s from "./templates.module.css";

type Variant = { name: string; prompt: string };

/// The page's one big button: Copy the prompt. When Claude Code gets its own wording, a small
/// switch above it picks which one is copied; otherwise there's nothing to choose. `children` sit
/// beside the button, in the same row.
export default function PromptCopy({ variants, className, children }: { variants: Variant[]; className?: string; children?: React.ReactNode }) {
  const [on, setOn] = useState(0);
  const current = variants[on] ?? variants[0];
  return (
    <div className={s.promptCopy}>
      {variants.length > 1 && (
        <div className={s.forAi} role="radiogroup" aria-label="Copy the prompt for">
          {variants.map((v, k) => (
            <button key={v.name} type="button" role="radio" aria-checked={k === on} tabIndex={k === on ? 0 : -1} className={s.forAiOption}
              onClick={() => setOn(k)} onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); setOn((on + 1) % variants.length); }
              }}>
              {v.name}
            </button>
          ))}
        </div>
      )}
      <div className={s.ctaRow}>
        <CopyButton text={current.prompt} label="Copy the prompt" className={className} />
        {children}
      </div>
    </div>
  );
}
