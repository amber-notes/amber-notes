# Where the functions run (2 October 2026)

## What was found

The privacy policy lists Supabase's server functions under Frankfurt. The function log's boot lines carry a region, and that day they showed `mcp` starting in `us-east-1`, `us-west-1`, `ca-central-1` and `ap-southeast-1` as well as `eu-central-1`. Supabase runs an Edge Function in the region nearest whoever calls it. The database is in `eu-central-1`.

## What Supabase offers

Per request only: the `x-region` header, or `?forceFunctionRegion=` where a header can't be set. There is no project or function setting. A region asked for this way is not replaced if it is down. Measured on this project against the metadata endpoint, reading `x-sb-edge-region` on the answer:

| Request from Sweden | Ran in |
|---|---|
| plain | `eu-central-1` |
| `x-region: us-east-1` | `us-east-1` |
| `?forceFunctionRegion=us-west-1` | `us-west-1` |
| `x-region: eu-central-1` | `eu-central-1` |

## Who calls the functions

| Caller | Can we add the header? |
|---|---|
| The site's proxy for `mcp.ambernotes.app` (every AI app that uses the address we publish) | Yes |
| The site's servers: the connect page's label, shared pages' files | Yes |
| The connect page in a browser, straight to the function | Only as a query parameter, in new deploys |
| The apps: connect requests, account status, delete and export | Not in the versions already shipped |
| Anything using the project's own function address (older connections, scripts) | No |

## The change

Callers we can't change are the reason the function pins itself: outside `FUNCTION_REGION` it sends the request, unprocessed, to the same function with `x-region` set to the home region, and returns the answer. It passes the caller's address under `MCP_PROXY_SECRET`, so rate limits count the caller and not the relay. A relayed request is never relayed again. If the home region doesn't answer, the request is answered where it landed and the log says `relay_failed`. The site also names the region on its own calls, which saves the hop for most traffic.

What this pins: where the request is acted on, where the database is read and where notes are opened in memory. What it can't pin: the path a request takes to get there. Cloudflare and Supabase's gateway receive it near the caller, as before, and the relaying function holds it in memory for the moment it takes to pass it on.

## Proof

Two instances of the runtime the hosted functions use (`edge-runtime` v1.77.0), one told it is `eu-central-1` and one `us-east-1`, the second's project address pointing at the first:

| Sent to the `us-east-1` instance | Answer |
|---|---|
| `POST /functions/v1/mcp/connect/ask?x=1` with a body, a token and `x-region: us-east-1` | 201, handler ran in `eu-central-1` with the same path, query, body and token; it saw the caller's address, not the relay's; `x-amber-region: eu-central-1`, `x-amber-relay: us-east-1` |
| `GET /functions/v1/mcp/.well-known/x?a=b` | ran in `eu-central-1` |
| The same POST with the home instance stopped | answered in `us-east-1` with its body intact; log `{"event":"relay_failed","where":"us-east-1","kind":"TypeError"}` |

Not proven before a deploy: that Supabase's gateway accepts a function calling its own address with `x-region`. It is an ordinary request to the gateway, and the header is measured to work from outside.

## After deploying

1. Deploy the four functions with `FUNCTION_REGION` unset: nothing is relayed, and every answer carries `x-amber-region` with the region it ran in.
2. `supabase secrets set FUNCTION_REGION=eu-central-1 --project-ref <ref>`
3. From anywhere: `curl -si -H 'x-region: us-east-1' https://<ref>.supabase.co/functions/v1/mcp/.well-known/oauth-authorization-server | grep -i -E 'x-amber|x-sb-edge'` should show `x-sb-edge-region: us-east-1` (where it landed), `x-amber-region: eu-central-1` (where it ran) and `x-amber-relay: us-east-1`.
4. In the function log, `relay` lines name the regions requests landed in. Boot lines outside `eu-central-1` will still appear: those isolates are the relays. What must not appear outside `eu-central-1` is work: any `tool`, `oauth_error` or `push` line whose `region` attribute is another region, and any `relay_failed` line.
