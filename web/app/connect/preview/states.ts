/// The states /connect/preview can show (?state=…).
export const PREVIEW_STATES = ["scan", "scanMac", "notifySignIn", "notifyNumber", "recover", "leaving", "checkIphone", "checkMac", "thisMac", "thisIphone"] as const;
export type PreviewState = (typeof PREVIEW_STATES)[number];
