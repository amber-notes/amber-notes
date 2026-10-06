"use client";

import { useState } from "react";
import { ButtonRow, ui } from "@/lib/ui";
import s from "./copy.module.css";

/// The prompt as you'd type it, and one button: copy, say so, then open Claude.
export default function CopyPrompt({ text, chatgpt }: { text: string; chatgpt: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      window.setTimeout(() => { window.location.href = "https://claude.ai/new"; }, 700);
    } catch {
      setState("failed");
    }
  }
  return (
    <>
      <p className={s.prompt}>{text}</p>
      <ButtonRow>
        <button type="button" className={ui.primary} onClick={copy}>{state === "copied" ? "Copied. Opening Claude…" : "Copy and open Claude"}</button>
        <a className={ui.quiet} href={chatgpt}>Ask ChatGPT instead</a>
      </ButtonRow>
      <p className={s.status} role="status">{state === "failed" ? "Couldn't copy. Select the text above and copy it by hand." : ""}</p>
    </>
  );
}
