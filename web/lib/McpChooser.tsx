"use client";

import { useState } from "react";
import s from "./post-parts.module.css";

/// "Which Apple Notes MCP setup works for you": one question, where they use AI, answered with the
/// one setup that works there, or plainly that none does. Everything is in the post below it; this
/// only picks. Answers are counted as blog_helper_used, with nothing about which answer.
type Where = "code" | "desktop" | "chatgpt" | "anywhere";

const CHOICES: [string, Where][] = [
  ["Claude Code or Codex", "code"],
  ["The Claude app on my Mac", "desktop"],
  ["ChatGPT", "chatgpt"],
  ["Claude on iPhone or the web", "anywhere"],
];

export function McpChooser() {
  const [where, setWhere] = useState<Where>();

  let verdict: React.ReactNode = null;
  if (where === "code") {
    verdict = (
      <>
        <p className={s.verdictTitle}>Use sweetrb/apple-notes-mcp</p>
        <p>It&apos;s one command in Claude Code and a plugin in Codex, on the Mac where your notes are. <a href="#set-it-up">The commands are below.</a></p>
      </>
    );
  } else if (where === "desktop") {
    verdict = (
      <>
        <p className={s.verdictTitle}>Start with Claude&apos;s own Apple Notes extension</p>
        <p>
          It installs from Claude&apos;s connectors directory, with nothing to configure. If you want more tools, such as moving and
          exporting notes, add sweetrb/apple-notes-mcp to Claude&apos;s config instead. <a href="#set-it-up">Both are below.</a>
        </p>
      </>
    );
  } else if (where) {
    verdict = (
      <>
        <p className={s.verdictTitle}>No Apple Notes MCP server works there</p>
        <p>
          {where === "chatgpt" ? "ChatGPT" : "Claude on iPhone and on the web"} only connect{where === "chatgpt" ? "s" : ""} to servers on the
          internet, and every Apple Notes server is a program on your Mac. <a href="#iphone-and-icloud">Why, and what does work.</a>
        </p>
      </>
    );
  }

  return (
    <div className={s.chooser}>
      <fieldset>
        <legend>Where do you want to use your notes?</legend>
        <div className={s.choices}>
          {CHOICES.map(([label, value]) => (
            <button key={value} type="button" aria-pressed={where === value} data-event="blog_helper_used" onClick={() => setWhere(value)}>{label}</button>
          ))}
        </div>
      </fieldset>
      {verdict && <div className={s.verdict} aria-live="polite">{verdict}</div>}
    </div>
  );
}
