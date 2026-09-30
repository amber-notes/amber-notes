// The connect page (/connect): where an AI's sign-in lands, and the way into the app.
//
// The MCP server's /authorize sends the browser here with ?request=<id>. Approval happens only in
// Amber Notes, the one place that holds the account's key for its notes, so the page names who is
// asking (the MCP server's public /connect/label, read by the server that renders the page) and
// opens the app with the universal link https://ambernotes.app/open/connect?request=<id>. When that
// link doesn't open the app (Chrome on a Mac, or a tap on an ambernotes.app link while already on
// ambernotes.app, which Safari keeps in the browser), /open/connect loads instead and tries the
// app's own scheme, ambernotes://connect?request=<id>.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validRequest = (id: string | undefined): id is string => !!id && UUID.test(id);

/// The universal link: opens the app's consent sheet for the request where the app is installed.
export const universalLink = (id: string) => `https://ambernotes.app/open/connect?request=${id.toLowerCase()}`;

/// The app's own scheme, for when the universal link stays in the browser.
export const appLink = (id: string) => `ambernotes://connect?request=${id.toLowerCase()}`;

/// What /connect/label answers for a pending request.
export type ConnectLabel = { client_name: string; verified_ai: "ChatGPT" | "Claude" | null };

/// The page's heading: who to approve, when the server could say.
export function approveHeading(label: ConnectLabel | null): string {
  const who = label?.verified_ai ?? plainName(label?.client_name);
  return who ? `Approve ${who} in Amber Notes on your iPhone or Mac` : "Approve this connection in Amber Notes on your iPhone or Mac";
}

/// The server's display name (the AI's name, or where access goes), shown only when short and plain.
function plainName(name: string | undefined): string | null {
  const s = (name ?? "").trim();
  return s && s.length <= 60 && /^[\p{L}\p{N} .,'&()+:_/-]+$/u.test(s) ? s : null;
}

/// Reads /connect/label from the MCP function. `headers` are what the function should see: the
/// proxy's, with the visitor's address, so its rate limit counts the visitor and not the site.
export async function fetchLabel(functionBase: string, id: string, headers: Headers, timeoutMs = 2500): Promise<ConnectLabel | null> {
  if (!validRequest(id)) return null;
  try {
    const res = await fetch(`${functionBase}/connect/label?id=${id.toLowerCase()}`, {
      headers, cache: "no-store", signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = await res.json() as Partial<ConnectLabel> | null;
    if (typeof body?.client_name !== "string") return null;
    const ai = body.verified_ai === "ChatGPT" || body.verified_ai === "Claude" ? body.verified_ai : null;
    return { client_name: body.client_name, verified_ai: ai };
  } catch {
    return null;
  }
}

/// Why /authorize sent someone here without a request (?problem=), in plain words. Unknown codes
/// get the general message; nothing from the address is ever shown.
export function problemText(code: string | undefined): string {
  switch (code) {
    case "unknown_app": return "Amber Notes doesn't know this app. Remove the connector and add it again.";
    case "wrong_return": return "The app's return address doesn't match what it registered. Remove the connector and add it again.";
    case "too_many": return "Too many attempts. Wait a few minutes, then start connecting again.";
    case "pkce": case "unsupported": case "wrong_server":
      return "The app asked to connect in a way Amber Notes doesn't support. Check that it uses the address https://mcp.ambernotes.app.";
    default: return "Start connecting again from ChatGPT, Claude or the other app you were using.";
  }
}

export const functionURL = (supabaseURL: string) => `${supabaseURL.replace(/\/+$/, "")}/functions/v1/mcp`;
