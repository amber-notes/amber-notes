// Signing in with the connector's own OAuth, the way Codex and Claude Code connect: discovery
// (RFC 8414), dynamic client registration (RFC 7591), authorization code with PKCE (RFC 7636) to a
// loopback redirect (RFC 8252), refresh-token rotation and revocation (RFC 7009). The person
// approves in Amber Notes on their iPhone or Mac; the server keeps only hashes of the tokens.
import { type Credentials, deleteCredentials, loadCredentials, saveCredentials, withLock } from "./store.ts";

/** What the server shows as the client's name when it can't vouch for it. */
export const CLIENT_NAME = "Terminal";
export const SCOPE = "notes:read notes:write";
const CALLBACK_PATH = "/callback";

export type Metadata = { issuer: string; authorization_endpoint: string; token_endpoint: string; registration_endpoint: string; revocation_endpoint?: string };

export async function discover(server: string): Promise<Metadata> {
  const res = await fetch(`${server}/.well-known/oauth-authorization-server`).catch((e) => { throw new Error(`Couldn't reach ${server}: ${e.message}`); });
  if (!res.ok) throw new Error(`${server} doesn't offer sign-in (no OAuth metadata, HTTP ${res.status}).`);
  return await res.json();
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const randomString = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
export async function challengeOf(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

/** A client id for this sign-in. Registered at each login: logins are rare, and the server forgets
 *  clients that sit idle without a connection, so a cached id could go stale. */
async function register(server: string, meta: Metadata): Promise<string> {
  const res = await fetch(meta.registration_endpoint, {
    method: "POST", headers: { "content-type": "application/json" },
    // Loopback redirects may use any port (RFC 8252 §7.3); the path is what's registered.
    body: JSON.stringify({ client_name: CLIENT_NAME, redirect_uris: [`http://127.0.0.1${CALLBACK_PATH}`], grant_types: ["authorization_code", "refresh_token"], token_endpoint_auth_method: "none", scope: SCOPE }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.client_id) throw new Error(`Registering with ${server} failed: ${body.error_description ?? res.status}`);
  return body.client_id;
}

export function authorizeURL(meta: Metadata, p: { clientId: string; redirect: string; challenge: string; state: string; resource: string; scope?: string }): string {
  const u = new URL(meta.authorization_endpoint);
  for (const [k, v] of Object.entries({ response_type: "code", client_id: p.clientId, redirect_uri: p.redirect, code_challenge: p.challenge, code_challenge_method: "S256", state: p.state, scope: p.scope ?? SCOPE, resource: p.resource })) u.searchParams.set(k, v);
  return u.toString();
}

/** The code from where the browser was sent back, checked against our state and issuer. */
export function codeFrom(returned: string, state: string, issuer: string): string {
  let u: URL;
  try { u = new URL(returned.trim()); } catch { throw new Error("That isn't the address from the browser. Copy the whole address, starting with http://127.0.0.1."); }
  const q = u.searchParams;
  if (q.get("error")) throw new Error(q.get("error") === "access_denied" ? "Declined in Pinto Notes. Nothing was connected." : `Sign-in failed: ${q.get("error_description") ?? q.get("error")}`);
  if (q.get("state") !== state) throw new Error("That sign-in was started somewhere else (its state doesn't match). Run amber login again.");
  // RFC 9207: the code must come from the server we asked.
  if (q.get("iss") && q.get("iss")!.replace(/\/+$/, "") !== issuer.replace(/\/+$/, "")) throw new Error(`The answer came from ${q.get("iss")}, not ${issuer}.`);
  const code = q.get("code");
  if (!code) throw new Error("The address has no code. Approve in Pinto Notes, then copy the address you land on.");
  return code;
}

const PAGE = (title: string, line: string) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>
<style>:root{color-scheme:light dark;font:16px/1.5 -apple-system,system-ui,sans-serif}body{display:grid;place-items:center;min-height:90vh;margin:0}main{max-width:26rem;padding:24px;text-align:center}h1{font-size:1.3rem;font-weight:600;margin:0 0 8px}p{margin:0;opacity:.7}</style>
<main><h1>${title}</h1><p>${line}</p></main>`;

export type LoginIO = { open(url: string): Promise<boolean>; say(line: string): void; ask(prompt: string): Promise<string | null> };

/** Signs in through the browser and Amber Notes; saves the tokens. */
export async function login(server: string, io: LoginIO, o: { noBrowser?: boolean; readOnly?: boolean } = {}): Promise<Credentials> {
  const meta = await discover(server);
  const clientId = await register(server, meta);
  const verifier = randomString(48);
  const state = randomString(16);

  // The loopback listener the browser comes back to (any free port).
  let deliver!: (u: string) => void;
  const returned = new Promise<string>((r) => (deliver = r));
  const ac = new AbortController();
  const listener = Deno.serve({ hostname: "127.0.0.1", port: 0, signal: ac.signal, onListen: () => {} }, (req) => {
    const u = new URL(req.url);
    if (u.pathname !== CALLBACK_PATH) return new Response("Not found", { status: 404 });
    deliver(req.url);
    const ok = u.searchParams.has("code") && u.searchParams.get("state") === state;
    return new Response(ok ? PAGE("You're signed in", "amber in your terminal can use your notes now. You can close this tab.") : PAGE("Not signed in", "Go back to the terminal to see why."), { headers: { "content-type": "text/html; charset=utf-8" } });
  });
  try {
    const redirect = `http://127.0.0.1:${listener.addr.port}${CALLBACK_PATH}`;
    const url = authorizeURL(meta, { clientId, redirect, challenge: await challengeOf(verifier), state, resource: server, scope: o.readOnly ? "notes:read" : SCOPE });
    const opened = !o.noBrowser && await io.open(url);
    if (opened) io.say("Opened your browser to connect. Approve in Pinto Notes on your iPhone or Mac.");
    io.say(`${opened ? "If it didn't open, go to" : "Open this in a browser"}:\n\n  ${url}\n`);
    if (!opened) io.say("Approve in Pinto Notes. If the browser is on another machine, it ends on a page that won't load:\ncopy that page's address (it starts with http://127.0.0.1) and paste it here.");
    // Whichever comes first: the browser coming back here, or an address pasted in.
    const pasted = opened ? new Promise<string>(() => {}) : io.ask("Address: ").then((a) => a ?? new Promise<string>(() => {}));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<string>((_, no) => (timer = setTimeout(() => no(new Error("No answer within 10 minutes. Run amber login again.")), 600_000)));
    const back = await Promise.race([returned, pasted, timeout]).finally(() => clearTimeout(timer));
    const code = codeFrom(back, state, meta.issuer);
    const res = await fetch(meta.token_endpoint, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: redirect, resource: server }),
    });
    const t = await res.json().catch(() => ({}));
    if (!res.ok || !t.access_token) throw new Error(`Sign-in failed: ${t.error_description ?? res.status}`);
    const creds: Credentials = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (t.expires_in ?? 3600) * 1000, client_id: clientId, scope: t.scope };
    await saveCredentials(server, creds);
    return creds;
  } finally {
    ac.abort();
    await listener.finished.catch(() => {});
  }
}

/** A token to call the server with: AMBER_TOKEN, or the saved one, refreshed when it's about to expire. */
export async function accessToken(server: string, force = false): Promise<string> {
  const env = Deno.env.get("AMBER_TOKEN");
  if (env) return env;
  const now = await loadCredentials(server);
  if (!now) throw new Error("Not signed in. Run `amber login`.");
  if (!now.refresh_token || (!force && (now.expires_at ?? Infinity) > Date.now() + 60_000)) return now.access_token;
  return await withLock(async () => {
    // Another amber may have refreshed while we waited for the lock.
    const c = await loadCredentials(server);
    if (!c) throw new Error("Not signed in. Run `amber login`.");
    if (c.access_token !== now.access_token || !c.refresh_token) return c.access_token;
    const meta = await discover(server);
    const res = await fetch(meta.token_endpoint, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: c.refresh_token, client_id: c.client_id ?? "", resource: server }),
    });
    const t = await res.json().catch(() => ({}));
    if (!res.ok || !t.access_token) {
      if (t.error === "invalid_grant") {
        await deleteCredentials(server);
        throw new Error("This terminal was disconnected from Pinto Notes (Settings › Connect an AI). Run `amber login` to connect again.");
      }
      throw new Error(`Couldn't renew the sign-in: ${t.error_description ?? res.status}`);
    }
    await saveCredentials(server, { ...c, access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (t.expires_in ?? 3600) * 1000, scope: t.scope });
    return t.access_token as string;
  });
}

/** Ends a connection on the server, as Disconnect in Settings does. A pasted access token can't end
 *  itself (only the app deletes those); false then. */
export async function revoke(server: string, c: Credentials): Promise<boolean> {
  if (!c.refresh_token && !c.access_token.startsWith("amb_at_")) return false;
  const meta = await discover(server).catch(() => null);
  if (!meta?.revocation_endpoint) return false;
  const res = await fetch(meta.revocation_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: c.refresh_token ?? c.access_token }) }).catch(() => null);
  await res?.body?.cancel();
  return Boolean(res?.ok);
}

/** Disconnects and forgets the sign-in. Answers what happened: "revoked", "forgotten" (a pasted
 *  token, still valid until it's deleted in the app) or "none". */
export async function logout(server: string): Promise<"revoked" | "forgotten" | "none"> {
  const c = await loadCredentials(server);
  if (!c) return "none";
  const done = await revoke(server, c);
  await deleteCredentials(server);
  return done ? "revoked" : "forgotten";
}
