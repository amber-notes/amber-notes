// What broke for Amber Notes users in the last 24 hours, as a short markdown report on this machine.
//   deno run -A scripts/ops/daily-digest.ts                # ~/content-tools/projects/amber-ops/digest/<date>.md
//   deno run -A scripts/ops/daily-digest.ts --hours 48 --out /tmp/digest.md
//
// Reads only, from the production project: its logs (Management API, ClickHouse SQL) and a
// read-only SQL query for the connect funnel, AI use, email sends and the apps' error reports. The
// token is SUPABASE_ACCESS_TOKEN, else the Supabase CLI's keychain entry; it is never printed.
// The report holds counts, error kinds and error messages with emails, ids and addresses blanked
// out: no names, no note content (notes are sealed anyway), and nothing is sent anywhere.

export const PROJECT = "rodegaeruhyybqilrnpn";
const API = `https://api.supabase.com/v1/projects/${PROJECT}`;

// MARK: Shaping (pure, tested in daily-digest.test.ts)

/** "anna@example.com" -> "a***@example.com". */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  return at < 1 ? "***" : `${email[0]}***${email.slice(at)}`;
}

/** A log message with anything that could say who blanked out, cut to one short line. */
export function scrub(text: string, max = 120): string {
  const out = String(text ?? "")
    .replace(/[\w.+-]+@([\w-]+(\.[\w-]+)+)/g, (m) => maskEmail(m))
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
    .replace(/\bBearer\s+\S+/gi, "Bearer <token>")
    .replace(/\b(amb|pane|sbp)_[\w]+/g, "<token>")
    .replace(/\b(\d{1,3}\.){3}\d{1,3}\b/g, "<address>")
    .replace(/[\s|]+/g, " ")
    .trim();
  return out.length > max ? out.slice(0, max - 1) + "~" : out;
}

/** /functions/v1/mcp/connect/3f2b... -> mcp/connect/:id */
export function functionPath(pathname: string): string {
  return pathname.replace(/^\/functions\/v1\//, "").replace(/[0-9a-f]{8}-[0-9a-f-]{27}|[\w-]{24,}/gi, ":id").replace(/\/$/, "");
}

export type Row = Record<string, string | number | null>;

export type Connect = {
  started: number; signed_in: number; approved: number; finished: number;
  stuck_without_device: number; by_client: Row[]; asks: Row[];
};

export type Digest = {
  start: Date; end: Date;
  accounts: { total: number; new: number; signed_in: number };
  auth: { actions: Row[]; requests: Row[]; providers: Row[]; errors: Row[] };
  functions: Row[];
  slowest: Row[];
  events: Row[];
  mcp: { posts: Row[]; refused_by: Row[]; grants_used: number; last_used: string | null; ai_edits: number };
  connect: Connect;
  app: { table: boolean; failures: Row[] };
  email: { sends: Row[]; resend: string };
  database: Row[];
  gaps: string[];
};

/** Auth log lines (grouped by path, provider, status, error, msg, from) as requests, provider
 *  hand-offs and errors. Errors from a local copy of the site (localhost) are left out. */
export function authLines(rows: Row[]): { requests: Row[]; providers: Row[]; errors: Row[] } {
  const add = (into: Map<string, Row>, key: string, row: Row) => {
    const had = into.get(key);
    into.set(key, had ? { ...had, n: n(had.n) + n(row.n) } : row);
  };
  const requests = new Map<string, Row>(), providers = new Map<string, Row>(), errors = new Map<string, Row>();
  const local = (r: Row) => /^(localhost|127\.0\.0\.1)$/.test(String(r.from ?? ""));
  for (const r of rows) {
    if (r.msg === "Redirecting to external provider" && r.provider) add(providers, String(r.provider), { provider: r.provider, n: r.n });
    if (r.msg !== "request completed") continue;
    add(requests, `${r.path} ${r.status ?? ""}`, { path: r.path, status: r.status || "", n: r.n });
    if (r.error && !local(r)) {
      const error = scrub(String(r.error));
      add(errors, `${r.path} ${error}`, { path: r.path, error, from: r.from || "", n: r.n });
    }
  }
  const byCount = (m: Map<string, Row>) => [...m.values()].sort((a, b) => n(b.n) - n(a.n));
  return { requests: byCount(requests), providers: byCount(providers), errors: byCount(errors) };
}

const n = (v: unknown) => Number(v ?? 0) || 0;
const sum = (rows: Row[], k: string, where: (r: Row) => boolean = () => true) => rows.filter(where).reduce((a, r) => a + n(r[k]), 0);
const QUIET_EVENTS = new Set(["db", "relay", "push", "push_off", "lifecycle_round", "lifecycle_unsubscribe"]);

/** The headline: what looks broken, most user-facing first. Empty when nothing does. */
export function findings(d: Digest): string[] {
  const out: string[] = [];
  const c = d.connect;
  if (c.started > 0 && c.finished === 0) {
    out.push(`Connecting an AI: ${c.started} tries, none finished (${c.signed_in} signed in, ${c.approved} approved).`);
  } else if (c.started > c.finished) {
    out.push(`Connecting an AI: ${c.finished} of ${c.started} tries finished (${c.signed_in} signed in, ${c.approved} approved).`);
  }
  if (c.stuck_without_device > 0) {
    out.push(`${c.stuck_without_device} signed in to connect an AI on an account with no Amber Notes device and no account key, so nothing could approve it.`);
  }
  const fiveHundreds = d.functions.filter((r) => n(r.status) >= 500);
  if (fiveHundreds.length) {
    out.push(`Server errors: ${fiveHundreds.map((r) => `${r.fn} ${r.status} x${r.n}`).join(", ")}.`);
  }
  const crashes = d.events.filter((r) => r.event === "tool_failed" || r.event === "rpc_failed" || r.event === "error" || String(r.event).endsWith("_failed"));
  if (crashes.length) {
    out.push(`Function failures: ${crashes.map((r) => `${r.event}${r.tool ? ` ${r.tool}` : ""}${r.where ? ` at ${r.where}` : ""} (${r.kind || "?"}${r.code ? ` ${r.code}` : ""}) x${r.n}`).join(", ")}.`);
  }
  const toolErrors = d.events.filter((r) => r.event === "tool_error");
  if (toolErrors.length) {
    out.push(`AI tool calls answered with an error: ${toolErrors.slice(0, 5).map((r) => `${r.tool} ${r.kind} x${r.n}`).join(", ")}.`);
  }
  const authErrors = sum(d.auth.errors, "n");
  if (authErrors) out.push(`Sign-in errors: ${d.auth.errors.slice(0, 3).map((r) => `${r.path} "${r.error}" x${r.n}`).join(", ")}.`);
  if (d.app.failures.length) out.push(`Note apps that failed to load: ${sum(d.app.failures, "n")}.`);
  const failedEmails = sum(d.email.sends, "n", (r) => r.status === "failed");
  if (failedEmails) out.push(`Emails that failed to send: ${failedEmails}.`);
  if (d.database.length) out.push(`Database errors: ${sum(d.database, "n")} (${d.database.slice(0, 2).map((r) => `"${r.message}"`).join(", ")}).`);
  if (d.mcp.grants_used === 0) {
    out.push(`No AI connection made a tool call${d.mcp.last_used ? ` (last one ${d.mcp.last_used.slice(0, 16).replace("T", " ")} UTC)` : ""}.`);
  }
  return out;
}

function table(head: string[], rows: (string | number | null)[][]): string {
  if (!rows.length) return "_none_\n";
  const cell = (v: string | number | null) => String(v ?? "").replace(/\|/g, "/");
  return [`| ${head.join(" | ")} |`, `|${head.map(() => " --- ").join("|")}|`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n") + "\n";
}

export function render(d: Digest): string {
  const when = (t: Date) => t.toISOString().slice(0, 16).replace("T", " ");
  const f = findings(d);
  const c = d.connect;
  const lines: string[] = [];
  lines.push(`# Amber Notes: what broke, ${d.end.toISOString().slice(0, 10)}`, "");
  lines.push(`${when(d.start)} to ${when(d.end)} UTC. Project ${PROJECT}. Counts and error kinds only.`, "");
  lines.push("## Needs a look", "");
  lines.push(...(f.length ? f.map((s) => `- ${s}`) : ["- Nothing the logs can see."]), "");

  lines.push("## Accounts and sign-in", "");
  lines.push(`${d.accounts.new} new accounts, ${d.accounts.signed_in} signed in, ${d.accounts.total} in all.`, "");
  lines.push(table(["Auth event", "Count"], d.auth.actions.map((r) => [r.action, r.n])));
  const recover = sum(d.auth.requests, "n", (r) => r.path === "/recover");
  const asked = sum(d.auth.actions, "n", (r) => r.action === "user_recovery_requested");
  const recovered = sum(d.auth.actions, "n", (r) => r.action === "user_updated_password");
  lines.push(`Password reset: ${recover} requests to /recover, ${asked} for an existing account (an email went out), ${recovered} passwords changed. ` +
    `A request for an address without an account sends nothing.`, "");
  lines.push(table(["Path", "Status", "Count"], d.auth.requests.map((r) => [r.path, r.status, r.n])));
  lines.push(table(["Sign in with", "Sent to the provider"], d.auth.providers.map((r) => [r.provider, r.n])));
  lines.push("Errors:", "", table(["Path", "Error", "From", "Count"], d.auth.errors.map((r) => [r.path, r.error, r.from, r.n])));

  lines.push("## Connecting an AI", "");
  lines.push(`${c.started} started, ${c.signed_in} signed in, ${c.approved} approved, ${c.finished} finished. ${c.stuck_without_device} signed in on an account with no device and no key.`, "");
  lines.push(table(["Client", "Started", "Signed in", "Finished"], c.by_client.map((r) => [r.client, r.started, r.signed_in, r.finished])));
  lines.push("Asks sent to devices:", "", table(["From", "Asked", "Answered", "Denied", "Ran out"], c.asks.map((r) => [r.started_from, r.n, r.answered, r.denied, r.expired])));

  lines.push("## AI connector (MCP)", "");
  lines.push(`${d.mcp.grants_used} connections made tool calls. AI edits: ${d.mcp.ai_edits}.`, "");
  lines.push(table(["POST /mcp status", "Count"], d.mcp.posts.map((r) => [r.status, r.n])));
  lines.push("Who got a 401 most (no or stale token):", "", table(["User agent", "Network", "Count"], d.mcp.refused_by.map((r) => [r.ua, r.org, r.n])));
  const tool = d.events.filter((r) => r.event === "tool_error" || r.event === "tool_failed");
  lines.push("Tool errors by tool and kind:", "", table(["Tool", "Event", "Kind", "Count"], tool.map((r) => [r.tool, r.event, r.kind, r.n])));

  lines.push("## Edge functions", "");
  lines.push(table(["Function", "Status", "Count", "Avg ms", "Max ms"], d.functions.map((r) => [r.fn, r.status, r.n, r.avg_ms, r.max_ms])));
  lines.push("Slowest calls:", "", table(["Path", "Status", "ms", "At (UTC)"], d.slowest.map((r) => [r.path, r.status, r.ms, String(r.at).slice(0, 16).replace("T", " ")])));
  const other = d.events.filter((r) => !QUIET_EVENTS.has(String(r.event)) && r.event !== "tool_error" && r.event !== "tool_failed");
  lines.push("Other function events:", "", table(["Event", "Where", "Kind", "Code", "Count"], other.map((r) => [r.event, r.where, r.kind, r.code, r.n])));

  lines.push("## Apps", "");
  lines.push(d.app.table
    ? table(["Device", "Message", "Count"], d.app.failures.map((r) => [r.device, r.message, r.n]))
    : "public.app_load_failures isn't in production yet.\n");

  lines.push("## Email", "");
  lines.push(table(["Kind", "Status", "Count"], d.email.sends.map((r) => [r.kind, r.status, r.n])));
  lines.push(d.email.resend, "");

  lines.push("## Database errors", "");
  lines.push(table(["Severity", "Message", "Count"], d.database.map((r) => [r.severity, r.message, r.n])));

  if (d.gaps.length) lines.push("## Couldn't read", "", ...d.gaps.map((g) => `- ${g}`), "");
  return lines.join("\n").replace(/[–—]/g, "-");
}

// MARK: Reading (network)

async function token(): Promise<string> {
  const env = Deno.env.get("SUPABASE_ACCESS_TOKEN");
  if (env) return env;
  const out = await new Deno.Command("security", { args: ["find-generic-password", "-s", "Supabase CLI", "-a", "access-token", "-w"], stdout: "piped", stderr: "null" }).output();
  let t = new TextDecoder().decode(out.stdout).trim();
  if (t.startsWith("go-keyring-base64:")) t = new TextDecoder().decode(Uint8Array.from(atob(t.slice(18)), (ch) => ch.charCodeAt(0)));
  if (!t.startsWith("sbp_")) throw new Error("No Supabase access token: set SUPABASE_ACCESS_TOKEN or run supabase login.");
  return t;
}

class Reader {
  constructor(private auth: string, private start: Date, private end: Date) {}

  /** ClickHouse SQL over the project's logs. The endpoint throttles hard, so it waits and retries. */
  async logs(sql: string): Promise<Row[]> {
    const q = new URLSearchParams({ sql, iso_timestamp_start: this.start.toISOString(), iso_timestamp_end: this.end.toISOString() });
    for (let attempt = 0; attempt < 10; attempt++) {
      const res = await fetch(`${API}/analytics/endpoints/logs?${q}`, { headers: { authorization: `Bearer ${this.auth}` } });
      const body = await res.json().catch(() => null);
      if (res.status === 429 || /Throttler|Too Many/.test(body?.message ?? "")) {
        await new Promise((r) => setTimeout(r, 15_000));
        continue;
      }
      if (!res.ok || body?.error) throw new Error(scrub(body?.error?.message ?? body?.error ?? body?.message ?? `HTTP ${res.status}`, 200));
      return body.result ?? [];
    }
    throw new Error("the logs endpoint kept throttling");
  }

  /** Read-only SQL against the database. */
  async sql<T = Row>(query: string): Promise<T[]> {
    const res = await fetch(`${API}/database/query`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.auth}`, "content-type": "application/json" },
      body: JSON.stringify({ query, read_only: true }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(scrub(body?.message ?? `HTTP ${res.status}`, 200));
    return body as T[];
  }
}

export async function collect(start: Date, end: Date): Promise<Digest> {
  const read = new Reader(await token(), start, end);
  const gaps: string[] = [];
  const attempt = async <T>(what: string, run: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await run();
    } catch (e) {
      gaps.push(`${what}: ${scrub((e as Error).message, 160)}`);
      return fallback;
    }
  };
  const from = `'${start.toISOString()}'::timestamptz`, to = `'${end.toISOString()}'::timestamptz`;

  // One at a time: the logs endpoint throttles bursts.
  const functions = await attempt("edge function calls", () => read.logs(`
    select extract(log_attributes['request.pathname'], '^/functions/v1/([^/]+)') as fn, log_attributes['response.status_code'] as status,
      count() as n, round(avg(toFloat64OrZero(log_attributes['execution_time_ms']))) as avg_ms, max(toFloat64OrZero(log_attributes['execution_time_ms'])) as max_ms
    from logs where source = 'function_edge_logs' group by fn, status order by fn, status`), [] as Row[]);
  const slowest = await attempt("slowest calls", () => read.logs(`
    select log_attributes['request.pathname'] as path, log_attributes['response.status_code'] as status, toFloat64OrZero(log_attributes['execution_time_ms']) as ms, timestamp as at
    from logs where source = 'function_edge_logs' and log_attributes['request.method'] != 'OPTIONS' order by ms desc limit 5`), [] as Row[]);
  const events = await attempt("function log events", () => read.logs(`
    select JSONExtractString(event_message, 'event') as event, JSONExtractString(event_message, 'tool') as tool, JSONExtractString(event_message, 'kind') as kind,
      JSONExtractString(event_message, 'code') as code, JSONExtractString(event_message, 'where') as where, count() as n
    from logs where source = 'function_logs' and startsWith(event_message, '{') group by event, tool, kind, code, where order by n desc limit 100`), [] as Row[]);
  const mcp = await attempt("MCP requests", () => read.logs(`
    select log_attributes['response.status_code'] as status, substring(log_attributes['request.headers.user_agent'], 1, 60) as ua,
      log_attributes['request.cf.asOrganization'] as org, count() as n
    from logs where source = 'function_edge_logs' and log_attributes['request.pathname'] = '/functions/v1/mcp' and log_attributes['request.method'] = 'POST'
    group by status, ua, org order by n desc limit 200`), [] as Row[]);
  const authRequests = await attempt("auth requests", () => read.logs(`
    select log_attributes['path'] as path, log_attributes['provider'] as provider, log_attributes['status'] as status, log_attributes['error'] as error,
      log_attributes['msg'] as msg, domain(log_attributes['referer']) as from, count() as n
    from logs where source = 'auth_logs' and log_attributes['path'] != '' and not startsWith(log_attributes['path'], '/admin')
    group by path, provider, status, error, msg, from order by n desc limit 100`), [] as Row[]);
  const authActions = await attempt("auth audit", () => read.logs(`
    select JSONExtractString(event_message, 'auth_audit_event', 'action') as action, count() as n
    from logs where source = 'auth_audit_logs' group by action order by n desc`), [] as Row[]);
  const database = await attempt("database errors", () => read.logs(`
    select log_attributes['parsed.error_severity'] as severity, event_message as message, count() as n
    from logs where source = 'postgres_logs' and log_attributes['parsed.error_severity'] in ('ERROR', 'FATAL', 'PANIC')
    group by severity, message order by n desc limit 10`), [] as Row[]);

  const [stats] = await attempt("database counts", () => read.sql<Row>(`
    select
      (select count(*) from auth.users) as total,
      (select count(*) from auth.users where created_at >= ${from} and created_at < ${to}) as new,
      (select count(*) from auth.users where last_sign_in_at >= ${from} and last_sign_in_at < ${to}) as signed_in,
      (select count(*) from public.mcp_tokens where last_used_at >= ${from} and last_used_at < ${to}) as grants_used,
      (select max(last_used_at) from public.mcp_tokens) as last_used,
      (select coalesce(sum(n), 0) from public.pane_activity where kind = 'ai_edit' and day >= ${from}::date) as ai_edits`), [{}] as Row[]);
  const byClient = await attempt("connect requests", () => read.sql<Row>(`
    select coalesce(c.client_name, 'unknown') as client, count(*) as started, count(r.claimed_by) as signed_in,
      count(r.grant_id) as approved, count(r.code_used_at) as finished,
      count(*) filter (where r.claimed_by is not null and r.grant_id is null
        and not exists (select 1 from public.key_devices k where k.user_id = r.claimed_by)
        and not exists (select 1 from public.account_keys k where k.user_id = r.claimed_by)) as stuck_without_device
    from public.oauth_requests r left join public.oauth_clients c on c.id = r.client_id
    where r.created_at >= ${from} and r.created_at < ${to} group by 1 order by 2 desc`), [] as Row[]);
  const asks = await attempt("connect asks", () => read.sql<Row>(`
    select coalesce(started_from, '?') as started_from, count(*) as n, count(answered_at) as answered, count(*) filter (where denied) as denied,
      count(*) filter (where answered_at is null and expires_at < now()) as expired
    from public.connect_asks where created_at >= ${from} and created_at < ${to} group by 1 order by 2 desc`), [] as Row[]);
  const sends = await attempt("email sends", () => read.sql<Row>(`
    select kind, status, count(*) as n from public.email_sends where created_at >= ${from} and created_at < ${to} group by 1, 2 order by 3 desc`), [] as Row[]);
  const [{ present }] = await attempt("app table", () => read.sql<{ present: boolean }>(`select to_regclass('public.app_load_failures') is not null as present`), [{ present: false }]);
  const failures = present
    ? await attempt("app load failures", () => read.sql<Row>(`
        select coalesce(device, '?') as device, left(message, 300) as message, count(*) as n
        from public.app_load_failures where at >= ${from} and at < ${to} group by 1, 2 order by 3 desc limit 20`), [] as Row[])
    : [];

  return {
    start, end, gaps,
    accounts: { total: n(stats?.total), new: n(stats?.new), signed_in: n(stats?.signed_in) },
    auth: {
      actions: authActions.filter((r) => r.action),
      // Each request ends in one "request completed" line; an error repeats as a line of its own.
      ...authLines(authRequests),
    },
    functions: functions.map((r) => ({ ...r, fn: r.fn || "?" })),
    slowest: slowest.map((r) => ({ ...r, path: functionPath(String(r.path)) })),
    events: events.filter((r) => r.event && r.event !== "db"),
    mcp: {
      posts: Object.entries(mcp.reduce<Record<string, number>>((a, r) => ({ ...a, [String(r.status)]: (a[String(r.status)] ?? 0) + n(r.n) }), {}))
        .map(([status, count]) => ({ status, n: count })),
      refused_by: mcp.filter((r) => r.status === "401").slice(0, 5).map((r) => ({ ua: scrub(String(r.ua), 60), org: r.org, n: r.n })),
      grants_used: n(stats?.grants_used),
      last_used: stats?.last_used ? String(stats.last_used) : null,
      ai_edits: n(stats?.ai_edits),
    },
    connect: {
      started: sum(byClient, "started"), signed_in: sum(byClient, "signed_in"), approved: sum(byClient, "approved"),
      finished: sum(byClient, "finished"), stuck_without_device: sum(byClient, "stuck_without_device"),
      by_client: byClient, asks,
    },
    app: { table: present, failures: failures.map((r) => ({ ...r, message: scrub(String(r.message)) })) },
    email: {
      sends,
      resend: "Resend bounces and complaints aren't read: the key on this machine can only send. A full-access key or a Resend webhook would add them.",
    },
    database: database.map((r) => ({ ...r, message: scrub(String(r.message)) })),
  };
}

if (import.meta.main) {
  const args = Deno.args;
  const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const hours = Number(opt("--hours") ?? 24);
  const end = new Date();
  const start = new Date(end.getTime() - hours * 3600_000);
  const home = Deno.env.get("HOME") ?? ".";
  const out = opt("--out") ?? `${home}/content-tools/projects/amber-ops/digest/${end.toISOString().slice(0, 10)}.md`;
  const report = render(await collect(start, end));
  await Deno.mkdir(out.slice(0, out.lastIndexOf("/")), { recursive: true });
  await Deno.writeTextFile(out, report);
  console.log(out);
}
