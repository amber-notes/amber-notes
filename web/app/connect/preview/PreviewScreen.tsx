"use client";

import type { ConnectLabel } from "@/lib/connect";
import ConnectScreen, { type Design, type ScreenProps, type View } from "../ConnectScreen";

export type PreviewState = "signIn" | "waiting" | "number" | "recover" | "leaving";

const LABEL: ConnectLabel = { claimed_name: "Claude", redirect_host: "claude.ai", loopback: false };
const REQUEST_ID = "00000000-0000-4000-8000-000000000000";
const noop = () => {};

/// One state of the connect page with fixed props: Dev preview only.
export default function PreviewScreen({ design, state, nudge }: { design: Design; state: PreviewState; nudge: boolean }) {
  const view: View = state === "number" ? { kind: "waiting" }
    : state === "leaving" ? { kind: "leaving", to: "https://claude.ai/api/mcp/auth_callback", allowed: true }
    : { kind: state };
  const props: ScreenProps = {
    design, view, recovering: state === "recover", requestId: REQUEST_ID, label: LABEL, request: null,
    number: state === "number" ? "42" : null, nudge, signedIn: null, failure: null, busy: false, ready: true,
    email: "", password: "", recoveryKey: "", write: true,
    on: { apple: noop, submitSignIn: (e) => e.preventDefault(), submitRecovery: (e) => e.preventDefault(), email: noop, password: noop, recoveryKey: noop, write: noop, showRecovery: noop, backToDevices: noop, startOver: noop },
  };
  return <ConnectScreen {...props} />;
}
