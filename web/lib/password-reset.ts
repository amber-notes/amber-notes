// Password reset, the steps that don't touch the screen (app/reset-password). See
// docs/Technical/password-reset.md.
//
// The rule that matters most: loading the page never spends the link. Mail scanners (Microsoft
// Defender Safe Links and others) open links in a real browser that runs scripts, so a page that
// redeemed the token on load would use it up before the person clicked, and they'd see "This link
// no longer works". A scanner loads pages; it doesn't type a password and press Save. So the token
// waits, and is redeemed only by savePassword.
//
// The link carries a token hash in its fragment (`#token_hash=…&type=recovery`), redeemed with
// POST /auth/v1/verify. A fragment never reaches a server, a proxy or a log, and the page takes it
// out of the address bar as soon as it has read it.
// That needs nothing stored in this browser, so the link works on any device and in a mail app's
// own browser. The reset is always requested without PKCE (request/route.ts and the apps), because
// a PKCE link can only be redeemed in the browser that asked for it.

// No imports, so scripts/password-reset-e2e.test.ts (Deno) runs this same code against a local stack.

/// The same check as the connect page's (lib/connect-flow.ts) and the apps'.
export const emailLooksValid = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

/// The same minimum the apps ask for (Pane/Views/EmailSignInFlow.swift) and the project enforces.
export const MIN_PASSWORD = 12;

/// What the address gives: a token waiting to be spent, a link Supabase already refused, or nothing.
export type ResetLink = { kind: "token"; tokenHash: string } | { kind: "refused" } | { kind: "none" };

export function readResetLink(query: URLSearchParams, fragment: URLSearchParams): ResetLink {
  // Supabase's own verify page redirects with an error in the query or the fragment.
  if (query.get("error_code") || fragment.get("error_code") || query.get("error") || fragment.get("error")) return { kind: "refused" };
  // The token only counts in the fragment: one in the query would have reached the server's logs.
  if (query.has("token_hash")) return { kind: "refused" };
  const tokenHash = fragment.get("token_hash")?.trim();
  if (tokenHash && fragment.get("type") === "recovery" && /^[A-Za-z0-9_-]{8,200}$/.test(tokenHash)) return { kind: "token", tokenHash };
  if (tokenHash) return { kind: "refused" };
  return { kind: "none" };
}

/// An email handed over in the fragment (`#email=…`) by the connect page's "Forgot password?".
/// The fragment never reaches a server or a log.
export function emailFromFragment(fragment: URLSearchParams): string {
  const email = fragment.get("email")?.trim() ?? "";
  return email.length <= 320 && emailLooksValid(email) ? email : "";
}

/// Said under the field before anything is sent, so a typo never spends the link.
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (password.length > 72) return "Use 72 characters or fewer.";
  return null;
}

/// The slice of Supabase Auth this page uses, over plain fetch (see authAPI).
export interface ResetAuth {
  /// Spends the link. A session's access token, or null when the link is used or expired.
  verify(tokenHash: string): Promise<string | null>;
  setPassword(accessToken: string, password: string): Promise<"ok" | "same" | "weak" | "expired" | "error">;
  /// Ends the session the link opened; the web never stays signed in. Sent with keepalive, so it
  /// also goes out when the page is closing.
  signOut(accessToken: string): Promise<void>;
}

export function authAPI(supabaseURL: string, anonKey: string, f: typeof fetch = fetch): ResetAuth {
  const base = `${supabaseURL.replace(/\/+$/, "")}/auth/v1`;
  const headers = (token = anonKey) => ({ apikey: anonKey, authorization: `Bearer ${token}`, "content-type": "application/json" });
  return {
    async verify(tokenHash) {
      try {
        const res = await f(`${base}/verify`, { method: "POST", headers: headers(), body: JSON.stringify({ type: "recovery", token_hash: tokenHash }) });
        const body = await res.json().catch(() => null) as { access_token?: unknown } | null;
        return res.ok && typeof body?.access_token === "string" ? body.access_token : null;
      } catch {
        throw new Error("offline");
      }
    },
    async setPassword(accessToken, password) {
      const res = await f(`${base}/user`, { method: "PUT", headers: headers(accessToken), body: JSON.stringify({ password }) });
      if (res.ok) return "ok";
      const body = await res.json().catch(() => null) as { error_code?: string; code?: string | number; msg?: string; message?: string } | null;
      const code = String(body?.error_code ?? body?.code ?? "");
      if (code === "same_password") return "same";
      if (code === "weak_password") return "weak";
      if (res.status === 401 || res.status === 403 || code === "session_not_found" || code === "bad_jwt") return "expired";
      return "error";
    },
    async signOut(accessToken) {
      await f(`${base}/logout?scope=local`, { method: "POST", headers: headers(accessToken), keepalive: true }).catch(() => undefined);
    },
  };
}

export type SaveOutcome = { kind: "done" } | { kind: "expired" } | { kind: "error"; message: string };

/// A link being saved: the token until it's spent, then the session it opened, so a retry after a
/// rejected password doesn't need the link again.
export type Pending = { tokenHash: string | null; session: string | null; inFlight?: Promise<SaveOutcome> };

export const newPending = (tokenHash: string): Pending => ({ tokenHash, session: null });

/// The page is going away (pagehide) before Save finished: end the session the link opened, if
/// it got that far, so no signed-in session outlives the page.
export function abandon(pending: Pending | null, auth: ResetAuth): void {
  if (!pending?.session) return;
  const session = pending.session;
  pending.session = null;
  void auth.signOut(session);
}

/// Save: check the password, spend the link (once), set the password, end the session. A second
/// press while the first is running gets the first one's answer.
export function savePassword(pending: Pending, password: string, auth: ResetAuth): Promise<SaveOutcome> {
  const problem = passwordProblem(password);
  if (problem) return Promise.resolve({ kind: "error", message: problem });
  pending.inFlight ??= run(pending, password, auth).finally(() => { pending.inFlight = undefined; });
  return pending.inFlight;
}

async function run(pending: Pending, password: string, auth: ResetAuth): Promise<SaveOutcome> {
  try {
    if (!pending.session) {
      if (!pending.tokenHash) return { kind: "expired" };
      const session = await auth.verify(pending.tokenHash);
      pending.tokenHash = null; // spent, whatever the answer
      if (!session) return { kind: "expired" };
      pending.session = session;
    }
    const result = await auth.setPassword(pending.session, password);
    if (result === "ok") {
      await auth.signOut(pending.session);
      pending.session = null;
      return { kind: "done" };
    }
    if (result === "expired") { pending.session = null; return { kind: "expired" }; }
    if (result === "same") return { kind: "error", message: "That's the password you have now. Choose a different one." };
    if (result === "weak") return { kind: "error", message: "Choose a longer password, one that isn't easy to guess." };
    return { kind: "error", message: "Your password wasn't changed. Try again in a moment." };
  } catch {
    return { kind: "error", message: "Can't reach Amber Notes. Check your connection and try again." };
  }
}

/// Ask for a link (request/route.ts). The answer is the same whether or not an account uses the
/// email; only a request that never got through says so.
export async function requestLink(email: string, f: typeof fetch = fetch): Promise<"sent" | "invalid" | "failed"> {
  if (!emailLooksValid(email)) return "invalid";
  try {
    const res = await f("/reset-password/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: email.trim() }) });
    if (res.ok) return "sent";
    return res.status === 400 ? "invalid" : "failed";
  } catch {
    return "failed";
  }
}
