"use client";

import { useState } from "react";
import type { Devices, Lead } from "@/lib/connect-flow";
import styles from "./connect.module.css";

// The signed-in connect page naming the one device to use, with one small picture of it, instead
// of "your iPhone or Mac". The heading is the thing to do, one sentence says it in full, and two
// quiet links are the ways out: send the notification again, or use the recovery key. No spinner
// and no "waiting" line: the page moves on by itself when the device answers, and until then the
// person is the one who has something to do. Which device comes from lib/connect-flow.ts (leadFor);
// the screens around it are ConnectFlowV1.tsx and ConnectScreens.tsx. /connect/preview shows each state.

/// What you do with the number: 1.1.2 and earlier have you type it on the device, 1.2 shows it
/// there for you to compare.
export type NumberAction = "type" | "compare";

type Named = Exclude<Lead, "recover" | "any">;

const TITLE: Record<Named, string> = {
  iphone: "Open Amber Notes on your iPhone", mac: "Open Amber Notes on your Mac",
  thisMac: "Open Amber Notes on this Mac", thisIphone: "Open Amber Notes on this iPhone",
};
const BODY: Record<Named, string> = {
  iphone: "Amber Notes sent a notification to your iPhone. Open the notification to approve this connection.",
  mac: "Amber Notes on your Mac asks you to approve this connection.",
  thisMac: "Amber Notes asks you to approve this connection.",
  thisIphone: "Amber Notes asks you to approve this connection.",
};
const WHERE: Record<Named, string> = { iphone: "on your iPhone", mac: "on your Mac", thisMac: "in Amber Notes", thisIphone: "in Amber Notes" };

/// The heading once the number shows: it names the number, the device and what to do with it.
export function numberTitle(lead: Named, number: string, action: NumberAction): string {
  if (action === "type") return `Type ${number} ${WHERE[lead]}`;
  return lead === "iphone" ? `Check that your iPhone shows ${number}` : lead === "mac" ? `Check that your Mac shows ${number}` : `Check that Amber Notes shows ${number}`;
}

/// The one sentence under the picture once the number shows. The second half is the safety check:
/// an app that doesn't ask for the number, or shows another one, isn't answering this page.
export function numberBody(lead: Named, number: string, action: NumberAction): string {
  const first = lead === "iphone" ? "Open the notification from Amber Notes" : null;
  if (action === "type") {
    return `${first ? `${first}, type ${number},` : `Type ${number} in Amber Notes,`} then choose Allow. If Amber Notes shows no number box, choose Don't allow.`;
  }
  return `${first ? `${first} and check that it shows ${number},` : `Check that Amber Notes shows ${number},`} then choose Allow. If the number is different, choose Don't allow.`;
}

/// Signed in: the one device to use, its picture, and the number once that device has opened the
/// request. `openLink` opens the app on this device. `onResend` sends the notification again and
/// answers with what went wrong, or null. `children` are the page's own small links.
export function DeviceScreen({ lead, devices, number, action, openLink, onRecover, onResend, children }: {
  lead: Named; devices: Devices; number: string | null; action: NumberAction;
  openLink: string; onRecover: () => void; onResend?: () => Promise<string | null>; children?: React.ReactNode;
}) {
  const here = lead === "thisMac" || lead === "thisIphone";
  return (
    <>
      <h1 className={styles.title}>{number ? numberTitle(lead, number, action) : TITLE[lead]}</h1>
      <DeviceArt mac={lead === "mac" || lead === "thisMac"} />
      {number && <span className={styles.matchNumber} aria-hidden="true">{number}</span>}
      <p className={styles.lede}>{number ? numberBody(lead, number, action) : BODY[lead]}</p>
      {here && !number && <a className={styles.primary} href={openLink}>Open Amber Notes</a>}
      {lead === "thisMac" && !number && (
        <p className={styles.small}>
          {devices.iphone ? "Nothing opened? Open the notification on your iPhone instead." : "Nothing opened? Amber Notes may be on another Mac."}
        </p>
      )}
      <div className={styles.links}>
        {lead === "iphone" && onResend && <Resend onResend={onResend} />}
        <button type="button" className={styles.link} onClick={onRecover}>Use your recovery key</button>
        {children}
      </div>
    </>
  );
}

/// "Send it again", and what happened when you did, said where the link was.
function Resend({ onResend }: { onResend: () => Promise<string | null> }) {
  const [state, setState] = useState<{ kind: "idle" | "sending" | "sent" } | { kind: "failed"; text: string }>({ kind: "idle" });
  async function send() {
    setState({ kind: "sending" });
    const problem = await onResend();
    setState(problem ? { kind: "failed", text: problem } : { kind: "sent" });
  }
  if (state.kind === "sent") return <p className={styles.linkSaid} role="status">Sent again. Look on your iPhone.</p>;
  return (
    <>
      <button type="button" className={styles.link} onClick={send} disabled={state.kind === "sending"}>
        {state.kind === "sending" ? "Sending…" : "Send it again"}
      </button>
      {state.kind === "failed" && <p className={styles.linkSaid} role="alert">{state.text}</p>}
    </>
  );
}

// MARK: The picture

/// The words of the push, as the server sends them (notifyDevices in the MCP function).
const PUSH_TITLE = "An AI connection request";
const PUSH_BODY = "Open Amber Notes to see it.";

/// The top of the device, running off the soft field's edge. On an iPhone: the notification in
/// its real words, with the app's mark and name, so you know what to look for and which app it is.
/// On a Mac: the app's icon and name on the screen. Flat cut paper in the page's own colours.
export function DeviceArt({ mac = false }: { mac?: boolean }) {
  return (
    <div className={`${styles.art} ${styles.artB}`} aria-hidden="true">
      {mac ? (
        <div className={styles.macTop}>
          <span className={styles.macCamera} />
          <div className={styles.macApp}>
            <img className={styles.pushMark} src="/mark-256.png" alt="" width={52} height={52} />
            <span>Amber Notes</span>
          </div>
        </div>
      ) : (
        <div className={styles.phoneTop}>
          <span className={styles.island} />
          <div className={styles.push}>
            <img className={styles.pushMark} src="/mark-256.png" alt="" width={34} height={34} />
            <div className={styles.pushText}>
              <span className={styles.pushApp}>Amber Notes<span>now</span></span>
              <span className={styles.pushTitle}>{PUSH_TITLE}</span>
              <span className={styles.pushBody}>{PUSH_BODY}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
