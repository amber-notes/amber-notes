# The functions used up the database's connections (2 October 2026)

## What happened

Calling the MCP function a few times a second made every database-backed endpoint answer 500 for about 20 seconds, for every caller. Measured against production that day:

| Calls, one after another | Answered | 500 |
|---|---|---|
| 30 to `/connect/status` | 11 | 19 |
| 169 to `/connect/label` | 121 | 48 |
| 12 to `/connect/status`, one a second | 12 | 0 |
| 20 to the OAuth metadata (no database) | 20 | 0 |

While that ran, other callers failed too: the logs show the same error on `/authorize`, `/connect/decide` and `/revoke` from a review script at 14:12 UTC.

## The cause

The function's log, for every one of those 500s:

```
{"event":"oauth_error","path_kind":"/connect/status","kind":"PostgresError","code":"53300"}
```

and Postgres's own log at the same time:

```
remaining connection slots are reserved for roles with the SUPERUSER attribute
```

53300 is `too_many_connections`. The database allows 60 connections and keeps 3 back. At rest 13 are in use (PostgREST, realtime, the pooler, monitoring), which leaves about 44. Each function isolate had its own postgres.js pool straight to Postgres (`SUPABASE_DB_URL`), up to 3 connections, kept for 20 idle seconds, and requests that arrive close together start many isolates. Forty isolates is enough.

## The fix

`supabase/functions/_shared/db.ts`: all four functions connect through Supabase's transaction pooler (port 6543), which shares a few real connections among any number of isolates and makes a busy moment a short wait. The pooler's host is the `DB_POOLER_HOST` secret; the user, password and database come from `SUPABASE_DB_URL`. Without the secret the functions connect directly with one connection per isolate, let go after 5 idle seconds. Before a request's own queries, one cheap query is tried up to four times when the database refuses the connection.

Transaction mode is safe here because nothing keeps state on a connection between transactions: settings are `set_config(..., true)` and locks are `pg_advisory_xact_lock`, inside `sql.begin`, and prepared statements were already off.

## Proof

Locally, against a throwaway Postgres limited to 20 connections, with PgBouncer in transaction mode as the pooler. `scripts/db-burst.ts` plays 40 isolates one after another, each with its own pool left open:

```sh
docker network create amber-dbburst
docker run -d --rm --name amber-dbburst-pg --network amber-dbburst -e POSTGRES_PASSWORD=burst -p 127.0.0.1:55432:5432 postgres:16-alpine -c max_connections=20
docker run -d --rm --name amber-dbburst-pool --network amber-dbburst -e DB_HOST=amber-dbburst-pg -e DB_USER=postgres -e DB_PASSWORD=burst -e DB_NAME=postgres -e POOL_MODE=transaction -e DEFAULT_POOL_SIZE=5 -e MAX_CLIENT_CONN=300 -e AUTH_TYPE=scram-sha-256 -p 127.0.0.1:56543:5432 edoburu/pgbouncer:latest
deno run -A scripts/db-burst.ts postgresql://postgres:burst@127.0.0.1:55432/postgres before 40
deno run -A scripts/db-burst.ts postgresql://postgres:burst@127.0.0.1:55432/postgres after 40
POOLED=1 deno run -A scripts/db-burst.ts postgresql://postgres:burst@127.0.0.1:56543/postgres after 40
docker stop amber-dbburst-pool amber-dbburst-pg && docker network rm amber-dbburst
```

| Run | Answered | Refused (53300) | Time |
|---|---|---|---|
| Direct, the old pool | 20 | 20 | 0.3 s |
| Direct, the new pool (the fallback) | 37 | 3 | 5.6 s |
| Through the pooler, the new pool | 40 | 0 | 0.4 s |

The fallback is better than before but not a fix: it waits for idle connections to be let go. The pooler is the fix.

On production, the same script through the real transaction pooler, 40 clients each, two runs a minute apart (14:27 and 14:29 UTC): 40 of 40 answered both times, none refused, and Postgres never had more than 15 client connections (13 at rest). No function logged 53300 during the runs. The function itself was not redeployed for this measurement, so the before numbers above are the live function and the after numbers are the path it will use.

## After deploying

1. `supabase secrets set DB_POOLER_HOST=aws-1-eu-central-1.pooler.supabase.com --project-ref <ref>`
2. Deploy the four functions.
3. The log should say `{"event":"db","mode":"pooled","max":3}` for `mcp`. Then 40 calls to `/connect/status` in a row should all answer 200.
