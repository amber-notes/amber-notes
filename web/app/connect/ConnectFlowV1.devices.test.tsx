// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConnectFlowV1 from "./ConnectFlowV1";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SUPABASE = "https://ref.supabase.co";
const MCP = `${SUPABASE}/functions/v1/mcp`;
const ID = "5a0f6c1e-2b1d-4c36-9e0a-6b6f0c1a2b3c";

type Call = { url: string; init: RequestInit };

/// A fake Supabase for the page public apps use: sign-in, /connect/ask (with `devices` when given)
/// and a status that stays "asked".
function fakeServer(devices?: { iphone: boolean; mac: boolean }) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
    if (url === `${MCP}/connect/ask`) return json({ asked: true, expires_at: new Date(Date.now() + 600_000).toISOString(), ...(devices ? { devices } : {}) });
    if (url === `${MCP}/connect/resend`) return json({ sent: true });
    if (url === `${MCP}/connect/status`) return json({ state: "asked" });
    if (url === `${SUPABASE}/auth/v1/token?grant_type=password`) return json({ access_token: "tok", user: { id: "u1", email: "me@example.com" } });
    if (url.startsWith(`${SUPABASE}/auth/v1/logout`)) return new Response(null, { status: 204 });
    if (url.startsWith(`${MCP}/connect/request`)) return json({ id: ID, client_name: "Glama", redirect_host: "glama.ai", redirect_uri: "https://glama.ai/cb", loopback: false, wants_write: true, expires_at: new Date(Date.now() + 600_000).toISOString() });
    if (url.startsWith(`${SUPABASE}/rest/v1/account_keys`)) return json([]);
    return json({ error: "not_found" }, 404);
  });
  return { calls, fetch };
}

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
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

const heading = () => container.querySelector("h1")?.textContent;

async function signIn(devices?: { iphone: boolean; mac: boolean }, on: { platform: string; ua: string } = { platform: "Win32", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }) {
  const server = fakeServer(devices);
  vi.stubGlobal("fetch", server.fetch);
  vi.spyOn(navigator, "platform", "get").mockReturnValue(on.platform);
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(on.ua);
  vi.spyOn(navigator, "maxTouchPoints", "get").mockReturnValue(0);
  act(() => root.render(<ConnectFlowV1 requestId={ID} supabaseURL={SUPABASE} anonKey="anon" label={null} recover={false} />));
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

const MAC = { platform: "MacIntel", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15" };
const signedOutAt = (calls: Call[]) => calls.findIndex((c) => c.url.startsWith(`${SUPABASE}/auth/v1/logout`));

describe("the page public apps use, before signing in", () => {
  it("shows \"Amber Notes on this Mac? Open it\" only on a Mac", async () => {
    for (const [on, shown] of [[MAC, true], [{ platform: "Win32", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }, false], [{ platform: "iPhone", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }, false]] as const) {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(on.platform);
      vi.spyOn(navigator, "userAgent", "get").mockReturnValue(on.ua);
      vi.spyOn(navigator, "maxTouchPoints", "get").mockReturnValue(0);
      act(() => root.render(<ConnectFlowV1 key={on.platform} requestId={ID} supabaseURL={SUPABASE} anonKey="anon" label={null} recover={false} />));
      await act(() => new Promise((r) => setTimeout(r, 0)));
      const open = [...container.querySelectorAll("a")].find((a) => a.textContent === "Open it");
      expect(Boolean(open), on.platform).toBe(shown);
      if (open) expect(open.getAttribute("href")).toBe(`https://ambernotes.app/open/connect?request=${ID}`);
      vi.restoreAllMocks();
    }
  });
});

describe("the page public apps use, once you've signed in", () => {
  it("says Open Amber Notes on your iPhone when the account has one, with no waiting line", async () => {
    const server = await signIn({ iphone: true, mac: false });
    await until(() => heading() === "Open Amber Notes on your iPhone");
    expect(container.textContent).toContain("Amber Notes sent a notification to your iPhone.");
    expect(container.textContent).not.toContain("iPhone or Mac");
    expect(container.textContent).not.toContain("Waiting");
    // Still signed in: the recovery key won't ask for the password again.
    expect(signedOutAt(server.calls)).toBe(-1);
  });

  it("sends the notification again with the page's pickup secret, and says so", async () => {
    const server = await signIn({ iphone: true, mac: false });
    await until(() => heading() === "Open Amber Notes on your iPhone");
    const again = [...container.querySelectorAll("button")].find((b) => b.textContent === "Send it again")!;
    await act(async () => again.click());
    await until(() => container.textContent!.includes("Sent again."));
    const call = server.calls.find((c) => c.url === `${MCP}/connect/resend`)!;
    expect(new Headers(call.init.headers).has("authorization")).toBe(false);
    expect(JSON.parse(String(call.init.body)).pickup).toMatch(/^[0-9a-f]{64}$/);
  });

  it("leads with one button on a Mac whose account has the Mac app", async () => {
    await signIn({ iphone: true, mac: true }, MAC);
    await until(() => heading() === "Open Amber Notes on this Mac");
    const open = [...container.querySelectorAll("a")].find((a) => a.textContent === "Open Amber Notes")!;
    expect(open.getAttribute("href")).toBe(`https://ambernotes.app/open/connect?request=${ID}`);
    expect(container.textContent).toContain("Nothing opened? Open the notification on your iPhone instead.");
  });

  it("names both, as before, when the server doesn't say", async () => {
    await signIn(undefined);
    await until(() => heading() === "Open Amber Notes on your iPhone or Mac");
  });

  it("goes to the recovery key, still signed in, when no app was seen lately", async () => {
    const server = await signIn({ iphone: false, mac: false });
    await until(() => server.calls.some((c) => c.url.startsWith(`${MCP}/connect/request?id=`)));
    const recover = server.calls.findIndex((c) => c.url.startsWith(`${MCP}/connect/request?id=`));
    expect(new Headers(server.calls[recover].init.headers).get("authorization")).toBe("Bearer tok");
    const out = signedOutAt(server.calls);
    expect(out === -1 || out > recover).toBe(true);
  });
});

describe("the recovery key after asking your devices", () => {
  it("never asks for the password a second time, and shows only the key and Allow", async () => {
    const server = await signIn({ iphone: true, mac: false });
    await until(() => heading() === "Open Amber Notes on your iPhone");
    const signIns = () => server.calls.filter((c) => c.url.includes("grant_type=password")).length;
    expect(signIns()).toBe(1);
    await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Use your recovery key")!.click());
    await until(() => !!container.querySelector("#connect-recovery"));
    expect(heading()).toBe("Use your recovery key");
    expect(container.querySelector("#connect-email")).toBeNull();
    expect(container.querySelector("#connect-password")).toBeNull();
    expect(container.textContent).toContain("glama.ai");
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
    expect(signIns()).toBe(1);
    expect(signedOutAt(server.calls)).toBe(-1);
  });
});
