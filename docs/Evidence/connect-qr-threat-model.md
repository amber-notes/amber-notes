# Connecting an AI by scanning: threat model

Written 2026-10-02 for the QR connect flow (branch `app/connect-qr`). It compares the new flow with the one it replaces: sign in on the web page, then type on your iPhone or Mac the two-digit number the page shows.

## The flow

1. ChatGPT, Claude or another MCP client starts OAuth. `/authorize` sends the browser to `ambernotes.app/connect?request=<id>`.
2. The page makes, in memory only:
   - a P-256 key pair (the handoff key, as before)
   - a pickup secret (32 bytes, as before)
   - a scan secret (16 bytes, new)

   It posts `/connect/scan` with the public key, `SHA-256(pickup)` and `SHA-256(scan secret)`. The page has no session, and the server stores the ask without an account.
3. The page shows a QR code for `https://ambernotes.app/open/connect?request=<id>#s=<scan secret>&k=<SHA-256 of the public key>`. On a Mac it also offers the same link as `ambernotes://connect?...`, labeled "Open Amber Notes on this Mac".
4. The iPhone camera, or the Mac button, opens Amber Notes with that link. The app:
   - reads the request with its own session, which claims the request for its account
   - gets the page's public key from `/connect/request`
   - checks the key's SHA-256 against `k`, and stops if they differ
5. The sheet asks "Allow Claude to use your notes?". Allow requires Face ID, Touch ID or the passcode.
6. The app makes the authorization code and sends the server only its hash and the data key wrapped under it, as before. It seals the code and the return address to the page's key and posts `/connect/decide` with the scan secret.
7. The server checks `SHA-256(scan secret)` against the stored hash under the ask's row lock, marks the request decided, and gives the ask to the account that answered.
8. The page polls `/connect/status` with its pickup secret, opens the sealed code and sends the browser to the AI.

There is still a fallback: "Get a notification instead" signs in on the page and posts `/connect/ask` with the same key and pickup. The account's devices get a push, and the page and the device show the same two digits from the commit and reveal protocol, which is unchanged. The person compares the two numbers instead of typing one.

## What each property rests on

| Property | Before (number typed) | Now (scan) |
|---|---|---|
| The person approving is at the screen that asked | Typing the number the page shows | Reading the code the page shows (the secret is only on that screen) |
| The device seals only to the page that asked | The number is derived from the page key plus both nonces, with commit before reveal | The page key's SHA-256 travels in the code, outside the server, and the device checks it |
| Single use | `oauth_requests.decided_at` set once, under lock | The same, and the scan secret is checked under the ask's row lock (a reloaded page replaces it) |
| Expiry | The ask expires with the request | The same (`expires_at` copied from the request) |
| Only the page gets the code | The code is sealed to the page key, and only the pickup secret collects it once | Unchanged |
| The server never sees the code or the data key | Code hash and wrapped key only | Unchanged |
| Face ID before handing over the key | Yes | Yes |
| Unrecognized app warning | Shown for unknown return addresses | Unchanged: shown only when the return address isn't a known AI callback |

## Threats

**Someone who can write the database (or a compromised server) swaps the page key.** Before, the commit and reveal made a swapped key show a different number. Now the device compares the key against the hash in the QR code, which never passed through the server. This is stronger: there are no two-digit odds of a collision.

**Someone learns the request id and posts `/connect/scan` with their own key.** The person's QR code still holds the hash of the real page's key, so the device refuses ("This code changed on your computer. Scan it again."). The outcome is denial of service only. A page that reloads replaces the ask again.

**Someone photographs or relays the QR code.** Whoever scans it first with a signed-in Amber Notes approves for their own account, and the code is sealed to the page's key, so only that browser gets it. Relaying the code lets a stranger approve their own notes into your browser's AI session. That doesn't expose your notes. It is the same as handing someone your screen.

**Consent phishing.** An attacker starts a real Claude sign-in on their own Claude account and gets the victim to scan the resulting code. Neither flow can tell whose Claude account it is. Both rely on the person only allowing a connection they just started, and on a notice to every device after a connection is made. The sheet names the AI by its return address (Claude's callback is Claude). For any other address it warns that Amber Notes doesn't recognize the app.

**Replay of the scan secret.** It works once: after `/connect/decide` the request is decided, and later calls get "expired". A reloaded page's new secret makes the old one fail. Tests: `oauth.pglite.test.ts`, the "Scanning the page's QR code" section.

**The secret in logs.** It sits in the URL fragment, which browsers don't send to servers. The page posts only its hash.

**The notification fallback, compared instead of typed.** This is the one weakening. With typing, an attacker who knows the person's password could not get an approval unless the person saw the attacker's screen. With comparing, a person who taps Allow without looking approves. What remains:
- the attacker must sign in on the page with the password
- the device shows "Allow only if your computer shows the same number"
- every device gets the "Connected" notice afterwards

If this isn't acceptable, the fallback can go back to typing without touching the QR path.

## Tests

- Server: `supabase/functions/mcp/oauth.pglite.test.ts`
  - "scanning the page's code approves without a number, and the page picks the code up once"
  - "a wrong or old scan secret answers nothing, and without one a device can't allow"
  - "a scan code expires with its request"
  - "signing in on the page for a notification keeps the code working, and the number path"
- App: `PaneTests/ConnectAITests.swift` `ConnectScanTests` (fragment parsing, the key check, the secret and sealing in the answer).
- Web: `web/app/connect/ConnectFlow.test.tsx` and `web/lib/*.test.ts`.
