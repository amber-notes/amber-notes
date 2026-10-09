"use client";

import { useState } from "react";
import { Path } from "./PostParts";
import s from "./post-parts.module.css";

/// "Find what's stopping the sync": up to three questions, one at a time, each answer a button, ending
/// in the one thing to do. It starts where Apple's own check starts (is the note in iCloud at all),
/// because that splits the problem in two: the device that wrote the note, or the device missing it.
/// Same shape as ResetChooser. Answers are counted as blog_helper_used, with nothing about which answer.
type Device = "iphone" | "mac";
type Answers = { web?: "yes" | "no" | "unknown"; where?: "icloud" | "local" | "mail"; on?: boolean; device?: Device };

const ICLOUD_NOTES: Record<Device, string[]> = {
  iphone: ["Settings", "Your name", "iCloud", "See All", "Notes", "Sync this iPhone"],
  mac: ["System Settings", "Your name", "iCloud", "Notes", "Sync this Mac"],
};

export function SyncChooser() {
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
  if (a.web === "unknown") {
    verdict = (
      <>
        <p className={s.verdictTitle}>Look there first</p>
        <p>Open icloud.com/notes in a browser and sign in with the Apple Account your iPhone uses. Whether the note is there tells you which device to fix, so come back and answer again.</p>
      </>
    );
  } else if (a.web === "no" && a.where === "local") {
    verdict = (
      <>
        <p className={s.verdictTitle}>That note was never going to sync</p>
        <p>On My iPhone and On My Mac keep notes on that one device. Move the note into a folder under iCloud and it reaches the others.</p>
        <p><a href="/blog/move-apple-notes-to-icloud">How to move notes to iCloud</a></p>
      </>
    );
  } else if (a.web === "no" && a.where === "mail") {
    verdict = (
      <>
        <p className={s.verdictTitle}>It syncs with that email account, not with iCloud</p>
        <p>The note shows up only on devices where the same email account has Notes turned on. To have it everywhere your iCloud notes are, move it into a folder under iCloud.</p>
        <p><a href="/blog/move-apple-notes-to-icloud">How to move notes to iCloud</a></p>
      </>
    );
  } else if (a.web === "no" && a.where === "icloud") {
    verdict = (
      <>
        <p className={s.verdictTitle}>The device you wrote it on hasn&apos;t uploaded it</p>
        <p>On that device, check that iCloud storage isn&apos;t full and that Notes is on for iCloud, then restart it. If Apple&apos;s System Status page shows a problem with iCloud Notes, wait for that instead.</p>
        <p><a href="#storage">Check your iCloud storage</a></p>
      </>
    );
  } else if (a.web === "yes" && a.on === false && a.device) {
    verdict = (
      <>
        <p className={s.verdictTitle}>Turn Notes on for iCloud on that {a.device === "mac" ? "Mac" : "iPhone"}</p>
        <p>iCloud has the note. This device isn&apos;t asking for it yet. The name at the top of {a.device === "mac" ? "System Settings" : "Settings"} is the Apple Account it syncs with, and it has to be the same one.</p>
        <Path steps={ICLOUD_NOTES[a.device]} />
      </>
    );
  } else if (a.web === "yes" && a.on === true) {
    verdict = (
      <>
        <p className={s.verdictTitle}>Restart that device, then check its software</p>
        <p>Apple&apos;s fix when the setting is already on is to restart the device and look again. If the note is listed but says it uses unsupported features, the device is on an older system than the one that wrote the note.</p>
        <p><a href="#update">Update the device that&apos;s behind</a></p>
      </>
    );
  }

  return (
    <div className={s.chooser}>
      {ask("Is the note at icloud.com/notes?", [["Yes, it's there", { web: "yes" }], ["No, it's missing", { web: "no" }], ["I haven't looked", { web: "unknown" }]], (v) => a.web === v.web)}
      {a.web === "no" && ask("On the device where you wrote it, which heading is the note under?", [["iCloud", { where: "icloud" }], ["On My iPhone or On My Mac", { where: "local" }], ["Gmail or another email account", { where: "mail" }]], (v) => a.where === v.where)}
      {a.web === "yes" && ask("On the device that's missing it, is Notes turned on for iCloud?", [["No, or I'm not sure", { on: false }], ["Yes, it's on", { on: true }]], (v) => a.on === v.on)}
      {a.web === "yes" && a.on === false && ask("Which device is missing the note?", [["iPhone", { device: "iphone" }], ["Mac", { device: "mac" }]], (v) => a.device === v.device)}
      {verdict && <div className={s.verdict} aria-live="polite">{verdict}</div>}
      {a.web !== undefined && <button type="button" className={s.restart} onClick={() => setA({})}>Start again</button>}
    </div>
  );
}
