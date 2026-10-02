/// The states /connect/preview can show (?state=…).
export const PREVIEW_STATES = ["scan", "scanMac", "notifySignIn", "notifyNumber", "recover", "leaving"] as const;
export type PreviewState = (typeof PREVIEW_STATES)[number];
