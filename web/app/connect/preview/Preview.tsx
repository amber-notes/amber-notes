"use client";

import { useState } from "react";
import { scanAppLink, scanLink } from "@/lib/connect-flow";
import { universalLink } from "@/lib/connect";
import { DeviceScreen, type DeviceArt, type NumberAction } from "../DeviceLead";
import type { PreviewState } from "./states";
import { LeavingScreen, NotifyScreen, NotifySignInScreen, RecoverScreen, ScanScreen } from "../ConnectScreens";

// The connect page's screens with fixed, made-up values. Nothing here talks to a server.


const ID = "5a0f6c1e-2b1d-4c36-9e0a-6b6f0c1a2b3c";
// Placeholders in the right shape (22 and 43 base64url characters), not real values.
const SCAN = "preview_scan_secret_01";
const FINGERPRINT = "preview_key_hash_" + "0".repeat(26);
const PREVIEW_LINK = scanLink(ID, SCAN, FINGERPRINT);
const TO = "claude.ai";
const noop = () => {};
const prevent = (e: React.FormEvent) => e.preventDefault();

export default function Preview({ state, art, number, action, both }: {
  state: PreviewState; art: DeviceArt; number: string | null; action: NumberAction; both: boolean;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [write, setWrite] = useState(true);
  const signIn = { email, password, onEmail: setEmail, onPassword: setPassword, onApple: noop, busy: false, ready: true, failure: null };
  switch (state) {
    case "scan":
      return <ScanScreen to={TO} link={PREVIEW_LINK} macLink={null} onNotify={noop} onRecover={noop} />;
    case "scanMac":
      return <ScanScreen to={TO} link={PREVIEW_LINK} macLink={scanAppLink(ID, SCAN, FINGERPRINT)} onNotify={noop} onRecover={noop} />;
    case "notifySignIn":
      return <NotifySignInScreen {...signIn} to={TO} onSubmit={prevent} onScan={noop} />;
    case "notifyNumber":
      return <NotifyScreen number="42" onScan={noop} />;
    case "recover":
      return (
        <RecoverScreen
          {...signIn} to={TO} signedIn={null} recoveryKey={recoveryKey} onRecoveryKey={setRecoveryKey}
          access={{ write, canWrite: true, onWrite: setWrite }} onSubmit={prevent} onScan={noop}
        />
      );
    case "checkIphone":
      return <DeviceScreen lead="iphone" devices={{ iphone: true, mac: both }} number={number} action={action} art={art} openLink={universalLink(ID)} onRecover={noop} />;
    case "checkMac":
      return <DeviceScreen lead="mac" devices={{ iphone: false, mac: true }} number={number} action={action} art={art} openLink={universalLink(ID)} onRecover={noop} />;
    case "thisMac":
      return <DeviceScreen lead="thisMac" devices={{ iphone: both, mac: true }} number={number} action={action} art={art} openLink={universalLink(ID)} onRecover={noop} />;
    case "thisIphone":
      return <DeviceScreen lead="thisIphone" devices={{ iphone: true, mac: both }} number={number} action={action} art={art} openLink={universalLink(ID)} onRecover={noop} />;
    case "leaving":
      return <LeavingScreen allowed host={TO} />;
  }
}
