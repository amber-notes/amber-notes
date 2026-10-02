import type { Devices, Lead } from "@/lib/connect-flow";
import styles from "./connect.module.css";

// The signed-in connect page naming the one device to use, with one small picture of it, instead
// of "your iPhone or Mac". Which device comes from lib/connect-flow.ts (leadFor); the screens
// around it are ConnectFlowV1.tsx and ConnectScreens.tsx. /connect/preview shows each state.

/// The picture for "Check your iPhone". Three candidates while the choice is open:
/// "a" the whole phone with the notification on its lock screen, the number beside it;
/// "b" the notification itself, in its real words, on the top of a phone, the number under it;
/// "c" the phone on an amber disc, and the number in two tiles shaped like the boxes you type it in.
export type DeviceArt = "a" | "b" | "c";
export const DEVICE_ART: DeviceArt = "b";

/// What you do with the number: 1.1.2 and earlier have you type it on the device, 1.2 shows it
/// there for you to compare.
export type NumberAction = "type" | "compare";

type Named = Exclude<Lead, "recover" | "any">;

const WHERE: Record<Named, string> = { iphone: "on your iPhone", mac: "on your Mac", thisMac: "in Amber Notes", thisIphone: "in Amber Notes" };
const WAITING: Record<Named, string> = {
  iphone: "Waiting for your iPhone…", mac: "Waiting for your Mac…", thisMac: "Waiting for Amber Notes…", thisIphone: "Waiting for Amber Notes…",
};
const TITLE: Record<Named, string> = {
  iphone: "Check your iPhone", mac: "Open Amber Notes on your Mac", thisMac: "Continue in Amber Notes", thisIphone: "Continue in Amber Notes",
};
const LEDE: Record<Named, string> = {
  iphone: "Amber Notes sent it a notification. Open it to see this request.",
  mac: "Amber Notes there asks you about this request.",
  thisMac: "Amber Notes asks you about this request.",
  thisIphone: "Amber Notes asks you about this request.",
};
const OPEN: Partial<Record<Named, string>> = { thisMac: "Open Amber Notes on this Mac", thisIphone: "Open Amber Notes on this iPhone" };

/// The heading once the number shows: it names the number, the device and what to do with it.
export function numberTitle(lead: Named, number: string, action: NumberAction): string {
  if (action === "type") return `Type ${number} ${WHERE[lead]}`;
  return lead === "iphone" ? `Check that your iPhone shows ${number}` : lead === "mac" ? `Check that your Mac shows ${number}` : `Check that Amber Notes shows ${number}`;
}

/// Signed in, waiting for a device: the one device to use, its picture, and the number once that
/// device has opened the request. `openLink` opens the app on this device. `children` are the
/// page's own small links, under the quiet line about the other ways.
export function DeviceScreen({ lead, devices, number, action, art = DEVICE_ART, openLink, onRecover, steps, children }: {
  lead: Named; devices: Devices; number: string | null; action: NumberAction; art?: DeviceArt;
  openLink: string; onRecover: () => void; steps?: React.ReactNode; children?: React.ReactNode;
}) {
  const phone = lead === "iphone" || lead === "thisIphone";
  const open = OPEN[lead];
  const after = action === "type"
    ? "Then choose Allow. If Amber Notes doesn't ask for a number, choose Don't allow."
    : "Then choose Allow. If it shows a different number, choose Don't allow.";
  return (
    <>
      {steps}
      <h1 className={styles.title}>{number ? numberTitle(lead, number, action) : TITLE[lead]}</h1>
      {phone
        ? <PhoneArt art={art} number={number} action={action} />
        : <div className={styles.art}><MacPicture />{number && <span className={styles.artNumber} aria-hidden="true">{number}</span>}</div>}
      <p className={styles.lede}>{number ? after : LEDE[lead]}</p>
      {open && !number && <a className={styles.primary} href={openLink}>{open}</a>}
      <p className={styles.status} role="status"><span className={styles.spinner} aria-hidden="true" /> {WAITING[lead]}</p>
      <OtherWays lead={lead} devices={devices} onRecover={onRecover} />
      {children}
    </>
  );
}

/// One quiet line for the other ways in: the other device when the account has one, and the
/// recovery key.
function OtherWays({ lead, devices, onRecover }: { lead: Named; devices: Devices; onRecover: () => void }) {
  const recover = (text: string) => <button type="button" className={styles.inlineLink} onClick={onRecover}>{text}</button>;
  if (lead === "iphone") {
    return devices.mac
      ? <p className={styles.small}>Not near your iPhone? Open Amber Notes on your Mac, or {recover("use your recovery key")}.</p>
      : <p className={styles.small}>Not near your iPhone? {recover("Use your recovery key")}.</p>;
  }
  if (lead === "mac") return <p className={styles.small}>Not near your Mac? {recover("Use your recovery key")}.</p>;
  if (lead === "thisMac") {
    return devices.iphone
      ? <p className={styles.small}>Nothing opened? Check your iPhone for a notification, or {recover("use your recovery key")}.</p>
      : <p className={styles.small}>Nothing opened? Amber Notes may be on another Mac. {recover("Use your recovery key")}.</p>;
  }
  return <p className={styles.small}>Nothing opened? {recover("Use your recovery key")}.</p>;
}

// MARK: The pictures

/// The words of the push, as the server sends them (notifyDevices in the MCP function).
const PUSH_TITLE = "An AI connection request";
const PUSH_BODY = "Open Amber Notes to see it.";

export function PhoneArt({ art, number, action }: { art: DeviceArt; number: string | null; action: NumberAction }) {
  if (art === "b") {
    return (
      <>
        <div className={`${styles.art} ${styles.artB}`} aria-hidden="true">
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
        </div>
        {number && <span className={styles.matchNumber} aria-hidden="true">{number}</span>}
      </>
    );
  }
  if (art === "c") {
    return (
      <div className={`${styles.art} ${styles.artC}`} aria-hidden="true">
        <PhonePicture tilted slots={number ? (action === "compare" ? number : "") : null} />
        {number && (
          <span className={styles.tiles}>
            {[...number].map((digit, i) => <span key={i} className={styles.tile}>{digit}</span>)}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className={styles.art} aria-hidden="true">
      <PhonePicture slots={null} />
      {number && <span className={styles.artNumber}>{number}</span>}
    </div>
  );
}

/// A phone in flat cut paper: the body, its screen, and on it either the notification (the app's
/// mark and two lines) or, with `slots`, the two boxes the number goes in (filled when it's given).
function PhonePicture({ tilted = false, slots }: { tilted?: boolean; slots: string | null }) {
  return (
    <svg className={styles.picture} viewBox="0 0 132 184" width={tilted ? 150 : 122} height={tilted ? 172 : 170} role="presentation" focusable="false">
      {tilted && <circle className={styles.pDisc} cx="66" cy="96" r="66" />}
      <g transform={tilted ? "rotate(-9 66 92)" : undefined}>
        <rect className={styles.pShadow} x="24" y="12" width="92" height="166" rx="21" />
        <rect className={styles.pBody} x="20" y="6" width="92" height="166" rx="21" />
        <rect className={styles.pScreen} x="25" y="11" width="82" height="156" rx="16" />
        <rect className={styles.pBody} x="54" y="16" width="24" height="7" rx="3.5" />
        {slots === null ? (
          <>
            <rect className={styles.pBar} x="46" y="34" width="40" height="9" rx="4.5" />
            <rect className={styles.pShadow} x="30" y="58" width="72" height="36" rx="10" />
            <rect className={styles.pPaper} x="30" y="56" width="72" height="36" rx="10" />
            <image href="/mark-256.png" x="35" y="61" width="15" height="15" />
            <rect className={styles.pBar} x="55" y="62" width="30" height="4.5" rx="2.25" />
            <rect className={styles.pBarSoft} x="55" y="70.5" width="41" height="4.5" rx="2.25" />
            <rect className={styles.pBarSoft} x="35" y="81" width="48" height="4.5" rx="2.25" />
          </>
        ) : (
          <>
            <image href="/mark-256.png" x="55" y="40" width="22" height="22" />
            <rect className={styles.pBar} x="44" y="70" width="44" height="4.5" rx="2.25" />
            {[0, 1].map((i) => (
              <g key={i}>
                <rect className={styles.pShadow} x={38 + i * 30} y="86" width="26" height="32" rx="7" />
                <rect className={styles.pPaper} x={38 + i * 30} y="84" width="26" height="32" rx="7" />
                {slots[i]
                  ? <text className={styles.pDigit} x={51 + i * 30} y="107" textAnchor="middle">{slots[i]}</text>
                  : i === 0 && <rect className={styles.pCaret} x="50" y="92" width="2" height="16" rx="1" />}
              </g>
            ))}
            <rect className={styles.pButton} x="38" y="132" width="56" height="16" rx="8" />
          </>
        )}
      </g>
    </svg>
  );
}

/// A Mac window in the same cut paper, with Amber Notes' question in it.
function MacPicture() {
  return (
    <svg className={styles.picture} viewBox="0 0 176 128" width={176} height={128} role="presentation" focusable="false">
      <rect className={styles.pShadow} x="10" y="12" width="160" height="110" rx="14" />
      <rect className={styles.pBody} x="6" y="6" width="160" height="110" rx="14" />
      <rect className={styles.pScreen} x="11" y="22" width="150" height="89" rx="9" />
      {[0, 1, 2].map((i) => <circle key={i} className={styles.pDot} cx={18 + i * 9} cy="14" r="2.5" />)}
      <rect className={styles.pShadow} x="46" y="36" width="80" height="64" rx="11" />
      <rect className={styles.pPaper} x="46" y="34" width="80" height="64" rx="11" />
      <image href="/mark-256.png" x="77" y="41" width="18" height="18" />
      <rect className={styles.pBar} x="60" y="65" width="52" height="4.5" rx="2.25" />
      <rect className={styles.pBarSoft} x="66" y="73.5" width="40" height="4.5" rx="2.25" />
      <rect className={styles.pButton} x="60" y="84" width="52" height="9" rx="4.5" />
    </svg>
  );
}
