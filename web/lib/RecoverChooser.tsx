"use client";

import { useState } from "react";
import s from "./post-parts.module.css";

/// "Where did my note go?": up to three questions, one at a time, each answer a button, ending in the
/// one place to look. Everything is on the page already (the steps are in the post below it); this
/// only picks. Answers are counted as blog_helper_used, with nothing about which answer.
type When = "recent" | "older" | "unsure";
type Account = "icloud" | "device" | "mail";
type Device = "iphone" | "mac" | "browser";
type Answers = { when?: When; account?: Account; device?: Device };

export function RecoverChooser() {
  const [a, setA] = useState<Answers>({});
  const ask = <K extends keyof Answers>(legend: string, key: K, choices: [string, NonNullable<Answers[K]>][], after: Partial<Answers> = {}) => (
    <fieldset>
      <legend>{legend}</legend>
      <div className={s.choices}>
        {choices.map(([label, value]) => (
          <button key={label} type="button" aria-pressed={a[key] === value} data-event="blog_helper_used" onClick={() => setA({ ...a, ...after, [key]: value })}>{label}</button>
        ))}
      </div>
    </fieldset>
  );

  let verdict: React.ReactNode = null;
  if (a.when === "unsure") {
    verdict = (
      <>
        <p className={s.verdictTitle}>Search all accounts before anything else</p>
        <p>Most missing notes are in another account, another folder, or an account that&apos;s switched off. <a href="#make-sure">Three checks, below.</a></p>
      </>
    );
  } else if (a.account === "mail") {
    verdict = (
      <>
        <p className={s.verdictTitle}>Look in that account&apos;s Trash, in Mail</p>
        <p>Gmail, Yahoo and other mail accounts don&apos;t use Recently Deleted. If the note is still in Trash, copy it into a new note. How long Trash keeps it is up to the account.</p>
      </>
    );
  } else if (a.when === "recent" && a.account && a.device) {
    const onlyThere = a.account === "device" && a.device === "browser";
    verdict = onlyThere ? (
      <>
        <p className={s.verdictTitle}>Open Notes on the device it was on</p>
        <p>Notes in On My iPhone or On My Mac aren&apos;t on iCloud.com. Recently Deleted on that iPhone or Mac still has them for 30 days.</p>
      </>
    ) : (
      <>
        <p className={s.verdictTitle}>It&apos;s in Recently Deleted</p>
        {a.device === "iphone" && <p>In Notes, go back to the folder list and tap Recently Deleted. Swipe left on the note, tap Move, and choose a folder.</p>}
        {a.device === "mac" && <p>In Notes, click Recently Deleted in the sidebar, then drag the note to another folder.</p>}
        {a.device === "browser" && <p>Go to icloud.com/notes, select Recently Deleted, select the note, then select Recover. It goes back to the Notes folder.</p>}
        <p><a href="#within-30-days">Every step, with pictures</a></p>
      </>
    );
  } else if (a.when === "older" && a.account === "icloud") {
    verdict = (
      <>
        <p className={s.verdictTitle}>It can&apos;t be brought back</p>
        <p>After 30 days Apple removes iCloud notes for good, and iCloud Backup doesn&apos;t include them. Any app that says otherwise can only guess. <a href="#next-time">Keep the next one safe.</a></p>
      </>
    );
  } else if (a.when === "older" && a.account === "device") {
    verdict = (
      <>
        <p className={s.verdictTitle}>Only an older backup has it</p>
        <p>On My iPhone notes are in iPhone backups, and On My Mac notes in Time Machine. Restoring a whole iPhone backup replaces what&apos;s on it now, so it&apos;s a last resort. <a href="#after-30-days">What to know first.</a></p>
      </>
    );
  }

  return (
    <div className={s.chooser}>
      {ask("When was it deleted?", "when", [["In the last 30 days", "recent"], ["Longer ago", "older"], ["I'm not sure it was", "unsure"]], { account: undefined, device: undefined })}
      {(a.when === "recent" || a.when === "older") && ask("Which account was it in?", "account", [["iCloud", "icloud"], ["On My iPhone or Mac", "device"], ["Gmail, Yahoo or other", "mail"]], { device: undefined })}
      {a.when === "recent" && (a.account === "icloud" || a.account === "device") && ask("Where are you looking?", "device", [["iPhone", "iphone"], ["Mac", "mac"], ["A browser", "browser"]])}
      {verdict && <div className={s.verdict} aria-live="polite">{verdict}</div>}
      {a.when !== undefined && <button type="button" className={s.restart} onClick={() => setA({})}>Start again</button>}
    </div>
  );
}
