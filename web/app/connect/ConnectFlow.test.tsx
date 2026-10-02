// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keyFingerprint, pageNumber, sha256Hex } from "@/lib/connect-flow";
import { fromBase64, handoffPayload, sealHandoff } from "@/lib/e2ee";
import { decodeQRMarkup } from "@/lib/qr.test-helpers";
import ConnectFlow from "./ConnectFlow";
import { APPLE_INSTEAD, MatchNumber, NotifySignInScreen } from "./ConnectScreens";
import { APPLE_ON_WEB } from "@/lib/connect";

const v = JSON.parse(readFileSync(resolve(__dirname, "../../../supabase/functions/_shared/e2ee-vectors.json"), "utf8"));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("the number on the connect page", () => {
  it("shows the vector's number for its page key, both nonces and the request, large and in words", async () => {
    const np = Uint8Array.from(Buffer.from(v.handoff.page_nonce, "hex"));
    const number = await pageNumber(fromBase64(v.handoff.browser_public), np, v.handoff.device_nonce, v.handoff.request_id);
    const html = renderToStaticMarkup(<MatchNumber number={number} />);
    expect(number).toBe(v.handoff.match_number);
    expect(html).toContain(`>${v.handoff.match_number}</span>`);
    expect(html).toContain(`Check that your phone shows ${v.handoff.match_number}, then choose Allow there.`);
  });
});

const ID = "5a0f6c1e-2b1d-4c36-9e0a-6b6f0c1a2b3c";
const SUPABASE = "https://ref.supabase.co";
const MCP = `${SUPABASE}/functions/v1/mcp`;
const LABEL = { claimed_name: null, redirect_host: "claude.ai", loopback: false };
const REDIRECT = "https://claude.ai/api/mcp/auth_callback?state=s1";

type Call = { url: string; init: RequestInit; body: Record<string, string> };

/// A fake Supabase: records every call, answers /connect/scan and /connect/ask, and /connect/status
/// with whatever `status` returns.
function fakeServer(status: (calls: Call[]) => Promise<unknown> | unknown, devices?: { iphone: boolean; mac: boolean }) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
    calls.push({ url, init, body });
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
    const expires_at = new Date(Date.now() + 600_000).toISOString();
    if (url === `${MCP}/connect/scan`) return json({ scan: true, expires_at });
    if (url === `${MCP}/connect/ask`) return json({ asked: true, expires_at, ...(devices ? { devices } : {}) });
    if (url === `${MCP}/connect/status`) return json(await status(calls));
    if (url === `${SUPABASE}/auth/v1/token?grant_type=password`) return json({ access_token: "tok", user: { id: "u1", email: "me@example.com" } });
    if (url.startsWith(`${SUPABASE}/auth/v1/logout`)) return new Response(null, { status: 204 });
    return json({ error: "not_found" }, 404);
  });
  return { calls, fetch };
}

let root: Root;
let container: HTMLElement;
let assigned: string[];

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  assigned = [];
  vi.spyOn(window.location, "assign").mockImplementation((u: string | URL) => { assigned.push(String(u)); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function until(check: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out; page shows: " + container.textContent);
    await act(() => new Promise((r) => setTimeout(r, 10)));
  }
}

function render() {
  act(() => root.render(<ConnectFlow requestId={ID} supabaseURL={SUPABASE} anonKey="anon" label={LABEL} recover={false} pollMs={20} />));
}

const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === text)!;
const heading = () => container.querySelector("h1")?.textContent;

describe("the connect page's QR code", () => {
  it("posts /connect/scan with a key and both hashes, shows a code for the right link, and follows the sealed handoff", async () => {
    let scanned = false;
    const server = fakeServer(async (calls) => {
      if (!scanned) return { state: "asked" };
      const scan = calls.find((c) => c.url.endsWith("/connect/scan"))!.body;
      return { state: "approved", handoff: await sealHandoff(handoffPayload({ code: "amb_code_1", redirect: REDIRECT }), fromBase64(scan.browser_key), ID) };
    });
    vi.stubGlobal("fetch", server.fetch);
    render();
    await until(() => !!container.querySelector("svg path"));

    expect(heading()).toBe("Scan with your iPhone");
    expect(container.textContent).toContain("Access goes to claude.ai.");
    const scan = server.calls.find((c) => c.url === `${MCP}/connect/scan`)!;
    expect(new Headers(scan.init.headers).has("authorization")).toBe(false);
    expect(Object.keys(scan.body).sort()).toEqual(["browser_key", "from", "id", "pickup_hash", "scan_hash"]);
    expect(scan.body.id).toBe(ID);
    expect(fromBase64(scan.body.browser_key)).toHaveLength(65);
    expect(scan.body.pickup_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(scan.body.scan_hash).toMatch(/^[0-9a-f]{64}$/);

    // The code reads back as the universal link with the secret whose hash went to the server and
    // the fingerprint of the key that did.
    const link = decodeQRMarkup(container.innerHTML)!;
    const m = /^https:\/\/ambernotes\.app\/open\/connect\?request=([0-9a-f-]{36})#s=([A-Za-z0-9_-]{22})&k=([A-Za-z0-9_-]{43})$/.exec(link);
    expect(m, link).not.toBeNull();
    expect(m![1]).toBe(ID);
    expect(await sha256Hex(m![2])).toBe(scan.body.scan_hash);
    expect(m![3]).toBe(await keyFingerprint(fromBase64(scan.body.browser_key)));

    // It polls /connect/status with the pickup whose hash it sent.
    await until(() => server.calls.some((c) => c.url.endsWith("/connect/status")));
    const pickup = server.calls.find((c) => c.url.endsWith("/connect/status"))!.body.pickup;
    expect(Buffer.from(await crypto.subtle.digest("SHA-256", Buffer.from(pickup, "hex"))).toString("hex")).toBe(scan.body.pickup_hash);

    scanned = true;
    await until(() => assigned.length > 0);
    const to = new URL(assigned[0]);
    expect(to.origin + to.pathname).toBe("https://claude.ai/api/mcp/auth_callback");
    expect(to.searchParams.get("code")).toBe("amb_code_1");
    expect(to.searchParams.get("state")).toBe("s1");
    expect(heading()).toBe("Connected");
    expect(container.textContent).toContain("Taking you back to claude.ai…");
  });

  it("shows the Mac button only on a Mac, with the same secret in the app's own scheme", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    vi.spyOn(navigator, "maxTouchPoints", "get").mockReturnValue(0);
    vi.stubGlobal("fetch", fakeServer(() => ({ state: "asked" })).fetch);
    render();
    await until(() => !!container.querySelector("svg path"));
    const mac = [...container.querySelectorAll("a")].find((a) => a.textContent === "Open Amber Notes on this Mac");
    const link = decodeQRMarkup(container.innerHTML)!;
    expect(mac?.getAttribute("href")).toBe(link.replace("https://ambernotes.app/open/connect?", "ambernotes://connect?"));
  });

  it("has no Mac button elsewhere", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    vi.stubGlobal("fetch", fakeServer(() => ({ state: "asked" })).fetch);
    render();
    await until(() => !!container.querySelector("svg path"));
    expect(container.textContent).not.toContain("Open Amber Notes on this Mac");
  });

  it("says when the request has expired", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "expired" }), { status: 404 })));
    render();
    await until(() => heading() === "This request has expired");
  });

  it("asks for a notification with the same key and pickup, and the code keeps working", async () => {
    const server = fakeServer(() => ({ state: "asked" }));
    vi.stubGlobal("fetch", server.fetch);
    render();
    await until(() => !!container.querySelector("svg path"));
    const before = decodeQRMarkup(container.innerHTML);

    await act(async () => button("Get a notification instead").click());
    expect(heading()).toBe("Sign in to get a notification");
    const type = (sel: string, value: string) => {
      const input = container.querySelector<HTMLInputElement>(sel)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => { type("#connect-email", "me@example.com"); type("#connect-password", "test-only"); });
    await act(async () => container.querySelector<HTMLFormElement>("form")!.requestSubmit());
    await until(() => server.calls.some((c) => c.url === `${MCP}/connect/ask`) && heading() === "Check your iPhone or Mac");

    const scan = server.calls.find((c) => c.url === `${MCP}/connect/scan`)!;
    const ask = server.calls.find((c) => c.url === `${MCP}/connect/ask`)!;
    expect(new Headers(ask.init.headers).get("authorization")).toBe("Bearer tok");
    expect(ask.body.browser_key).toBe(scan.body.browser_key);
    expect(ask.body.pickup_hash).toBe(scan.body.pickup_hash);
    expect(ask.body.match_commit).toMatch(/^[0-9a-f]{64}$/);
    expect(server.calls.filter((c) => c.url === `${MCP}/connect/scan`)).toHaveLength(1);
    // Signed out straight after asking.
    expect(server.calls.some((c) => c.url.startsWith(`${SUPABASE}/auth/v1/logout`))).toBe(true);

    // Back to the code: the same one.
    await act(async () => button("Scan the code instead").click());
    await until(() => !!container.querySelector("svg path"));
    expect(decodeQRMarkup(container.innerHTML)).toBe(before);
  });
});

describe("naming the device once you've signed in", () => {
  async function signInForANotification(devices: { iphone: boolean; mac: boolean }) {
    const server = fakeServer(() => ({ state: "asked" }), devices);
    vi.stubGlobal("fetch", server.fetch);
    render();
    await until(() => !!container.querySelector("svg path"));
    await act(async () => button("Get a notification instead").click());
    const type = (sel: string, value: string) => {
      const input = container.querySelector<HTMLInputElement>(sel)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => { type("#connect-email", "me@example.com"); type("#connect-password", "test-only"); });
    await act(async () => container.querySelector<HTMLFormElement>("form")!.requestSubmit());
    await until(() => server.calls.some((c) => c.url === `${MCP}/connect/ask`));
    return server;
  }
  const signedOut = (calls: Call[]) => calls.findIndex((c) => c.url.startsWith(`${SUPABASE}/auth/v1/logout`));

  it("says Check your iPhone when the account has one, and keeps the way back to the code", async () => {
    const server = await signInForANotification({ iphone: true, mac: false });
    await until(() => heading() === "Check your iPhone");
    expect(container.textContent).toContain("Amber Notes sent it a notification.");
    expect(container.textContent).toContain("Not near your iPhone? Use your recovery key.");
    expect(container.textContent).not.toContain("Mac");
    expect(signedOut(server.calls)).toBeGreaterThan(-1);
    expect(button("Scan the code instead")).toBeTruthy();
  });

  it("leads with the recovery key, still signed in, when no app was seen lately", async () => {
    const server = await signInForANotification({ iphone: false, mac: false });
    await until(() => server.calls.some((c) => c.url.startsWith(`${MCP}/connect/request?id=`)));
    const asked = server.calls.findIndex((c) => c.url === `${MCP}/connect/ask`);
    const recover = server.calls.findIndex((c) => c.url.startsWith(`${MCP}/connect/request?id=`));
    // The recovery key's first step ran with the session the ask used: nothing signed out in between.
    expect(new Headers(server.calls[recover].init.headers).get("authorization")).toBe("Bearer tok");
    const out = signedOut(server.calls);
    expect(out === -1 || out > recover).toBe(true);
    expect(recover).toBeGreaterThan(asked);
  });
});

describe("signing in for a notification", () => {
  it("offers Sign in with Apple and email while it's on for the web", () => {
    const html = renderToStaticMarkup(
      <NotifySignInScreen to="claude.ai" onSubmit={() => {}} onScan={() => {}} email="" password="" onEmail={() => {}} onPassword={() => {}}
        onApple={() => {}} busy={false} ready failure={null} />,
    );
    expect(APPLE_ON_WEB).toBe(true);
    expect(html).toContain("Sign in with Apple");
    expect(html).not.toContain(APPLE_INSTEAD.replace(/'/g, "&#x27;"));
  });
});

describe("the recovery key path", () => {
  const vectors = JSON.parse(readFileSync(resolve(__dirname, "../../../supabase/functions/_shared/e2ee-vectors.json"), "utf8"));

  /// Types into a React-controlled field.
  function type(selector: string, value: string) {
    const input = container.querySelector<HTMLInputElement>(selector)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function allowWithRecoveryKey(wantsWrite: boolean) {
    const server = fakeServer(() => ({ state: "asked" }));
    const inner = server.fetch.getMockImplementation()!;
    server.fetch.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
      if (url === `${SUPABASE}/auth/v1/token?grant_type=password`) {
        server.calls.push({ url, init, body: {} });
        return json({ access_token: "tok", user: { id: vectors.user_id, email: "me@example.com" } });
      }
      if (url.startsWith(`${MCP}/connect/request`)) {
        return json({ id: ID, client_name: "Claude", redirect_host: "claude.ai", redirect_uri: "https://claude.ai/api/mcp/auth_callback", loopback: false, wants_write: wantsWrite, expires_at: new Date(Date.now() + 600_000).toISOString() });
      }
      if (url.startsWith(`${SUPABASE}/rest/v1/account_keys`)) {
        return json([{ key_id: vectors.key_id, verifier: vectors.verifier, recovery_wrap: vectors.recovery.wrap }]);
      }
      if (url === `${MCP}/connect/decide`) {
        server.calls.push({ url, init, body: JSON.parse(String(init.body)) });
        return json({ redirect: REDIRECT });
      }
      return inner(input, init);
    });
    vi.stubGlobal("fetch", server.fetch);
    render();
    await until(() => !!container.querySelector("svg path"));
    await act(async () => button("No iPhone? Use your recovery key").click());
    await until(() => heading() === "Use your recovery key");
    // Access sits under a closed Options, already at Read and edit.
    const options = container.querySelector("details")!;
    expect(options.open).toBe(false);
    expect(container.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe("Read and edit");
    await act(async () => {
      type("#connect-email", "me@example.com");
      type("#connect-password", "test-password-for-a-fake-server");
      type("#connect-recovery", vectors.recovery.typed);
    });
    await act(async () => container.querySelector<HTMLFormElement>("form")!.requestSubmit());
    await until(() => server.calls.some((c) => c.url === `${MCP}/connect/decide`));
    return server.calls.find((c) => c.url === `${MCP}/connect/decide`)!.body;
  }

  it("allows Read and edit without opening Options when the app asked to write", async () => {
    const decided = await allowWithRecoveryKey(true);
    expect(decided.allow).toBe(true);
    expect(decided.write).toBe(true);
  });

  it("gives an app that asked only to read no more than that", async () => {
    const decided = await allowWithRecoveryKey(false);
    expect(decided.write).toBe(false);
  });
});
