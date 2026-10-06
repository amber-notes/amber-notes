"use client";

import { useState } from "react";
import { Path } from "./PostParts";
import s from "./post-parts.module.css";

/// "Which reset applies to you": three questions, one at a time, each answer a button, ending in the
/// one thing to do. Everything is on the page already (the steps are in the post below it); this only
/// picks. Answers are counted as blog_helper_used, with nothing about which answer.
type Answers = { know?: boolean; tried?: boolean; device?: "iphone" | "mac" };

export function ResetChooser() {
  const [a, setA] = useState<Answers>({});
  const ask = (legend: string, choices: [string, Partial<Answers>][], picked: (c: Partial<Answers>) => boolean) => (
    <fieldset>
      <legend>{legend}</legend>
      <div className={s.choices}>
        {choices.map(([label, value]) => (
          <button key={label} type="button" aria-pressed={picked(value)} data-event="blog_helper_used" onClick={() => setA({ ...a, ...value })}>{label}</button>
        ))}
      </div>
    </fieldset>
  );

  let verdict: React.ReactNode = null;
  if (a.know === true && a.device) {
    verdict = (
      <>
        <p className={s.verdictTitle}>Change it, don&apos;t reset it</p>
        <p>Changing moves every locked note to the new password, so you end up with one password, not two.</p>
        <Path steps={a.device === "mac" ? ["Notes", "Settings", "Change Password"] : ["Settings", "Apps", "Notes", "Password", "The account", "Change Password"]} />
      </>
    );
  } else if (a.know === false && a.tried === false) {
    verdict = (
      <>
        <p className={s.verdictTitle}>Try these before anything else</p>
        <p>Face ID or Touch ID, the hint (it shows after a couple of wrong tries), your iPhone passcode or Mac login password, any older notes password, and your password manager. <a href="#try-these-first">The details are below.</a></p>
      </>
    );
  } else if (a.know === false && a.tried === true && a.device) {
    verdict = (
      <>
        <p className={s.verdictTitle}>Reset it, for the notes you lock from now on</p>
        <p>Your old locked notes stay locked with the old password. Nothing is deleted, and they open again if you ever remember it.</p>
        <Path steps={a.device === "mac" ? ["Notes", "Settings", "Reset Password"] : ["Settings", "Apps", "Notes", "Password", "The account", "Reset Password"]} />
        <p><a href={a.device === "mac" ? "#reset-on-a-mac" : "#reset-on-iphone"}>Every step, on {a.device === "mac" ? "a Mac" : "iPhone"}</a></p>
      </>
    );
  }

  return (
    <div className={s.chooser}>
      {ask("Do you still know your current notes password?", [["Yes, I want a new one", { know: true }], ["No, I've forgotten it", { know: false }]], (v) => a.know === v.know)}
      {a.know === false && ask("Have you tried Face ID, the hint and your device passcode?", [["Not yet", { tried: false }], ["Yes, none worked", { tried: true }]], (v) => a.tried === v.tried)}
      {(a.know === true || a.tried === true) && ask("Where are you resetting it?", [["iPhone", { device: "iphone" }], ["Mac", { device: "mac" }]], (v) => a.device === v.device)}
      {verdict && <div className={s.verdict} aria-live="polite">{verdict}</div>}
      {a.know !== undefined && <button type="button" className={s.restart} onClick={() => setA({})}>Start again</button>}
    </div>
  );
}
