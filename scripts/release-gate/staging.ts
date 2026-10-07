// The release gate's work on the staging project (docs/Technical/release-gate.md). Never production:
// every command reads the staging ref from .secrets/staging.env and refuses Amber Notes' own.
//
//   deno run -A scripts/release-gate/staging.ts ensure <notes>     the bench account with that many notes
//                                                                  and the gate's three notes; prints its file
//   deno run -A scripts/release-gate/staging.ts creds <notes>      {email, password, recovery} for the app's stdin
//   deno run -A scripts/release-gate/staging.ts arrive <notes>     changes the "Gate arriving note", as another device would
//   deno run -A scripts/release-gate/staging.ts rls <a> <b>        account a can't read or change b's rows
//   deno run -A scripts/release-gate/staging.ts plaintext           no table holds the gate's note text in the clear
//   deno run -A scripts/release-gate/staging.ts bytes <notes>...    server bytes per bench account
//   deno run -A scripts/release-gate/staging.ts latency <notes>     p50 and p95 of MCP, account and sync calls
//   deno run -A scripts/release-gate/staging.ts advisors            the security and performance advisors
//
// Output is JSON on stdout. Secrets are read from files and never printed.
import { keyIdOf, newDataKey, parseRecoveryKey, recoveryKEK, recoveryKeyText, unwrap, Vault, verifierOf, wrap } from "../../supabase/functions/_shared/e2ee.ts";
import { previewOf, titleOf } from "../../supabase/functions/mcp/notes.ts";

const PRODUCTION_REF = "rodegaeruhyybqilrnpn";
const ROOT = new URL("../..", import.meta.url).pathname;
const common = new TextDecoder().decode((await new Deno.Command("git", { args: ["-C", ROOT, "rev-parse", "--path-format=absolute", "--git-common-dir"] }).output()).stdout).trim();
const SECRETS = Deno.env.get("AMBER_SECRETS") ?? `${common.replace(/\/\.git$/, "")}/.secrets`;
const env = Object.fromEntries((await Deno.readTextFile(`${SECRETS}/staging.env`)).split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const REF = env.STAGING_REF;
if (!REF || REF === PRODUCTION_REF) throw new Error("not the staging project");
const URL_ = `https://${REF}.supabase.co`;

/** The Management API token `supabase login` keeps in the Keychain. */
async function managementToken(): Promise<string> {
  const fromEnv = Deno.env.get("SUPABASE_ACCESS_TOKEN");
  if (fromEnv) return fromEnv;
  const out = await new Deno.Command("security", { args: ["find-generic-password", "-s", "Supabase CLI", "-a", "access-token", "-w"], stdout: "piped", stderr: "null" }).output();
  const raw = new TextDecoder().decode(out.stdout).trim();
  return raw.startsWith("go-keyring-base64:") ? atob(raw.slice("go-keyring-base64:".length)) : raw;
}
async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(`https://api.supabase.com${path}`, { method, headers: { authorization: `Bearer ${await managementToken()}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return await r.json();
}
/** Read-only SQL on staging, through the Management API. */
async function sql(query: string): Promise<Record<string, unknown>[]> {
  return await api("POST", `/v1/projects/${REF}/database/query`, { query, read_only: true });
}
async function keys() {
  const list = await api("GET", `/v1/projects/${REF}/api-keys?reveal=true`) as { name: string; api_key: string }[];
  return { anon: list.find((k) => k.name === "anon")!.api_key, service: list.find((k) => k.name === "service_role")!.api_key };
}

// MARK: Accounts

const file = (n: number) => `${SECRETS}/staging-bench-${n}.txt`;
type Creds = { email: string; password: string; recovery: string };
async function creds(n: number): Promise<Creds> {
  const s = await Deno.readTextFile(file(n));
  return { email: s.match(/Email:\s*(\S+)/)![1], password: s.match(/Password:\s*(.+)/i)![1].trim(), recovery: s.match(/^Recovery key:\s*(\S.*?)\s*$/mi)![1] };
}

type Session = { user: string; token: string; anon: string; vault: Vault };
async function signIn(c: Pick<Creds, "email" | "password">, anon: string) {
  const a = await (await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: anon, "content-type": "application/json" }, body: JSON.stringify(c) })).json();
  if (!a.access_token) throw new Error("sign-in failed");
  return { user: a.user.id as string, token: a.access_token as string };
}
const headers = (s: { token: string; anon: string }) => ({ apikey: s.anon, authorization: `Bearer ${s.token}`, "content-type": "application/json", "x-pane-device": "Mac", "x-amber-client": "lock-aware/1 e2ee/1" });
async function rest(s: { token: string; anon: string }, method: string, path: string, data?: unknown, prefer = "return=representation") {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { method, headers: { ...headers(s), prefer }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}
async function session(n: number): Promise<Session> {
  const { anon } = await keys();
  const c = await creds(n);
  const { user, token } = await signIn(c, anon);
  const state = (await rest({ token, anon }, "POST", "rpc/account_key_state", {})).body;
  const dk = await unwrap(state.key.recovery_wrap, await recoveryKEK((await parseRecoveryKey(c.recovery))!, user), "recovery", user);
  if (await verifierOf(dk, user) !== state.key.verifier) throw new Error("the recovery key doesn't match");
  return { user, token, anon, vault: await Vault.from(dk, user) };
}

/** A fixed id per account and purpose, so the gate's notes are found again without opening every title. */
async function gateID(user: string, label: string) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${user}:release-gate:${label}`)));
  h[6] = (h[6] & 0x0f) | 0x40; h[8] = (h[8] & 0x3f) | 0x80;
  const x = Array.from(h.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** The same shapes as the app's PerfProbe: headings, lists, checklists, links, quotes. */
function longNote(lines = 5000) {
  const out = ["Gate long note"];
  for (let i = 0; out.length < lines; i++) {
    out.push([
      `## Section ${Math.floor(i / 12)}`,
      `A paragraph with **bold**, *italic*, \`code\` and a [link](https://example.com/${i}) in it, long enough to wrap on a narrow window.`,
      `- Bullet item ${i}`, `  - Nested item ${i}`, `- [ ] Open task ${i}`, `- [x] Done task ${i}`, `1. Numbered ${i}`, `> A quote ${i}`,
      "", `Plain line ${i} ~~struck~~ <u>underlined</u>`, "", `Another line of ordinary text for line ${i}.`,
    ][i % 12]);
  }
  return out.join("\n");
}
const GATE_NOTES: [string, () => string][] = [
  ["short", () => "Gate short note\n\nA short note the release gate opens.\n\n- one\n- two\n"],
  ["typing", () => "Gate typing note\n\nTyped here by the release gate.\n"],
  ["long", () => longNote()],
];

async function sealNote(s: Session, id: string, body: string) {
  return { id, body_ct: await s.vault.sealBody(id, body), head_ct: await s.vault.sealHead(id, { title: titleOf(body), preview: previewOf(body) }) };
}

async function ensure(n: number) {
  const { anon, service } = await keys();
  try { await Deno.stat(file(n)); } catch {
    // A new bench account: confirmed, with its key made the way the apps make it.
    const email = `amber-bench-${n}-${crypto.randomUUID().slice(0, 6)}@ambernotes.app`;
    const password = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18)))).replace(/[/+=]/g, "");
    const made = await fetch(`${URL_}/auth/v1/admin/users`, { method: "POST", headers: { apikey: service, authorization: `Bearer ${service}`, "content-type": "application/json" }, body: JSON.stringify({ email, password, email_confirm: true }) });
    if (!made.ok) throw new Error(`creating the account: ${made.status}`);
    const { user, token } = await signIn({ email, password }, anon);
    const state = (await rest({ token, anon }, "POST", "rpc/account_key_state", {})).body;
    const dk = newDataKey();
    const recovery = crypto.getRandomValues(new Uint8Array(16));
    const text = await recoveryKeyText(recovery);
    await Deno.writeTextFile(file(n), `Staging bench account, ${n} notes (scripts/release-gate/staging.ts)\nEmail: ${email}\nPassword: ${password}\nRecovery key: ${text}\n`, { mode: 0o600 });
    const key = await rest({ token, anon }, "POST", "rpc/create_account_key", { p_key_id: await keyIdOf(dk), p_verifier: await verifierOf(dk, user), p_recovery_wrap: await wrap(dk, await recoveryKEK(recovery, user), "recovery", user), p_generation: state?.generation ?? 0 });
    if (key.status >= 300) throw new Error(`creating the key: ${key.status}`);
    // Nobody reads these addresses: no onboarding emails.
    await api("POST", `/v1/projects/${REF}/database/query`, { query: `insert into public.email_unsubscribes (user_id, source) values ('${user}', 'link') on conflict (user_id) do nothing` });
  }
  const s = await session(n);
  const count = async () => Number((await fetch(`${URL_}/rest/v1/notes?select=id&deleted_at=is.null`, { headers: { ...headers(s), prefer: "count=exact", range: "0-0" } })).headers.get("content-range")?.split("/")[1] ?? 0);
  // The bench notes first (scripts/page-evals/staging-bench.ts adds only what's missing), then the gate's own.
  if (n > 1 && await count() < n) {
    const cfg = await Deno.makeTempFile({ suffix: ".xcconfig" });
    const app = await Deno.readTextFile(`${ROOT}/Config/Backend.staging.local.xcconfig`);
    await Deno.writeTextFile(cfg, app);
    const seeded = await new Deno.Command("deno", { args: ["run", "-A", `${ROOT}/scripts/page-evals/staging-bench.ts`, "seed", file(n), String(n)], env: { AMBER_BACKEND_CONFIG: cfg }, stdout: "inherit", stderr: "inherit" }).output();
    await Deno.remove(cfg);
    if (!seeded.success) throw new Error("seeding failed");
  }
  for (const [label, body] of GATE_NOTES) {
    const id = await gateID(s.user, label);
    const have = (await rest(s, "GET", `notes?select=id,deleted_at,trashed_at&id=eq.${id}`)).body;
    if (have?.length && !have[0].deleted_at && !have[0].trashed_at) continue;
    const row = await sealNote(s, id, body());
    const r = have?.length ? await rest(s, "PATCH", `notes?id=eq.${id}`, { ...row, deleted_at: null, trashed_at: null }) : await rest(s, "POST", "notes", { ...row, folder_id: null, parent_id: null, is_pinned: false });
    if (r.status >= 300) throw new Error(`gate note ${label}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  }
  return { file: file(n), user: s.user, notes: await count() };
}

/** Another device changes a note: the "Gate arriving note", made the first time. */
async function arrive(n: number) {
  const s = await session(n);
  const id = await gateID(s.user, "arriving");
  const row = await sealNote(s, id, `Gate arriving note\n\nArrived at ${new Date().toISOString()}.\n`);
  const have = (await rest(s, "GET", `notes?select=id&id=eq.${id}`)).body;
  const r = have?.length ? await rest(s, "PATCH", `notes?id=eq.${id}`, row) : await rest(s, "POST", "notes", { ...row, folder_id: null, parent_id: null, is_pinned: false });
  if (r.status >= 300) throw new Error(`arrive: ${r.status}`);
  return { at: Date.now() };
}

// MARK: Security

async function publicTables() {
  return (await sql(`select c.relname as name, c.relrowsecurity as rls,
      exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'user_id') as has_user
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`)) as { name: string; rls: boolean; has_user: boolean }[];
}

/** Account a, signed in, against b's rows: reading, changing and deleting them all come back empty. */
async function rls(a: number, b: number) {
  const A = await session(a), B = await session(b);
  const problems: string[] = [];
  const tables = await publicTables();
  for (const t of tables) {
    if (!t.rls) problems.push(`${t.name}: row-level security is off`);
    // Signed out (the anon key alone) sees nothing.
    const anon = await fetch(`${URL_}/rest/v1/${t.name}?select=*&limit=1`, { headers: { apikey: A.anon } });
    const anonRows = anon.ok ? await anon.json() : [];
    if (anon.ok && anonRows.length) problems.push(`${t.name}: readable without signing in`);
    if (!t.has_user) continue;
    const other = await rest(A, "GET", `${t.name}?select=user_id&user_id=eq.${B.user}&limit=1`);
    if (other.status < 300 && other.body?.length) problems.push(`${t.name}: ${a} reads ${b}'s rows`);
    const mine = await rest(A, "GET", `${t.name}?select=user_id&user_id=neq.${A.user}&limit=1`);
    if (mine.status < 300 && mine.body?.length) problems.push(`${t.name}: ${a} sees rows that aren't its own`);
  }
  // Writes aimed at b's note, by id.
  const target = await gateID(B.user, "short");
  const patch = await rest(A, "PATCH", `notes?id=eq.${target}`, { is_pinned: true });
  if (patch.status < 300 && patch.body?.length) problems.push(`notes: ${a} changed ${b}'s note`);
  const del = await rest(A, "DELETE", `notes?id=eq.${target}`);
  if (del.status < 300 && del.body?.length) problems.push(`notes: ${a} deleted ${b}'s note`);
  const steal = await rest(A, "POST", "notes", { id: target, body_ct: "x", head_ct: "x", user_id: B.user });
  if (steal.status < 300) problems.push(`notes: ${a} wrote a row as ${b}`);
  const still = (await rest(B, "GET", `notes?select=id,is_pinned,deleted_at&id=eq.${target}`)).body;
  if (!still?.length || still[0].deleted_at) problems.push(`notes: ${b}'s note is gone after ${a}'s attempts`);
  return { tables: tables.length, withUserId: tables.filter((t) => t.has_user).length, problems };
}

/** The gate's plain note text, searched for in every public table, every row, as text. */
async function plaintext() {
  const needles = ["gate-plaintext-canary", "Typed here by the release gate", "A short note the release gate opens", "Gate arriving note"];
  const found: string[] = [];
  for (const t of await publicTables()) {
    const rows = await sql(`select count(*)::int as n from public."${t.name}" r where ${needles.map((s) => `r::text like '%${s}%'`).join(" or ")}`);
    if (Number(rows[0]?.n) > 0) found.push(`${t.name}: ${rows[0].n} rows`);
  }
  const objects = await sql(`select count(*)::int as n from storage.objects o where ${needles.map((s) => `o.name like '%${s}%' or o.metadata::text like '%${s}%'`).join(" or ")}`);
  if (Number(objects[0]?.n) > 0) found.push(`storage.objects: ${objects[0].n} names or metadata`);
  return { needles: needles.length, found };
}

async function bytes(ns: number[]) {
  const out: Record<string, unknown> = {};
  const tables = (await publicTables()).filter((t) => t.has_user);
  for (const n of ns) {
    const { user } = await signIn(await creds(n), (await keys()).anon);
    if (!/^[0-9a-f-]{36}$/.test(user)) throw new Error("bad user id");
    const parts = await sql(tables.map((t) => `select '${t.name}' as t, coalesce(sum(pg_column_size(r.*)), 0)::bigint as b, count(*)::int as rows from public."${t.name}" r where r.user_id = '${user}'`).join(" union all "));
    const files = await sql(`select coalesce(sum((metadata->>'size')::bigint), 0)::bigint as b, count(*)::int as n from storage.objects where owner = '${user}'`);
    const byTable = Object.fromEntries(parts.filter((p) => Number(p.b) > 0).map((p) => [p.t, Number(p.b)]));
    out[n] = { rowBytes: parts.reduce((s, p) => s + Number(p.b), 0), fileBytes: Number(files[0].b), byTable };
  }
  return out;
}

// MARK: Latency

function pct(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) : null;
}

async function latency(n: number, repeat = 20) {
  const s = await session(n);
  const out: Record<string, { p50: number | null; p95: number | null; errors: number }> = {};
  const time = async (name: string, f: () => Promise<Response>) => {
    const t0 = performance.now();
    let ok = false;
    try { const r = await f(); ok = r.ok; await r.body?.cancel(); } catch { /* counted below */ }
    const ms = performance.now() - t0;
    const row = (out as Record<string, { ms?: number[]; errors: number }>)[name] ??= { ms: [], errors: 0 } as never;
    (row as unknown as { ms: number[] }).ms.push(ms);
    if (!ok) row.errors++;
  };
  // The app's calls: the sync pull with nothing new, a full first page of notes, and the account functions.
  const since = new Date(Date.now() - 60_000).toISOString();
  for (let i = 0; i < repeat; i++) {
    await time("sync pull, nothing new", () => fetch(`${URL_}/rest/v1/notes?select=*&updated_at=gt.${since}&order=updated_at.asc&limit=500`, { headers: headers(s) }));
    await time("sync pull, 500 notes", () => fetch(`${URL_}/rest/v1/notes?select=*&order=updated_at.asc&limit=500`, { headers: headers(s) }));
    await time("sync push, one note", async () => {
      const id = await gateID(s.user, "typing");
      return await fetch(`${URL_}/rest/v1/notes?id=eq.${id}`, { method: "PATCH", headers: { ...headers(s), prefer: "return=minimal" }, body: JSON.stringify(await sealNote(s, id, "Gate typing note\n\nTyped here by the release gate.\n")) });
    });
    await time("account-status", () => fetch(`${URL_}/functions/v1/account-status`, { method: "POST", headers: headers(s), body: JSON.stringify({ email: "nobody-release-gate@ambernotes.app" }) }));
    if (i < 5) await time("account export", () => fetch(`${URL_}/functions/v1/account/export`, { headers: headers(s) }));
  }
  // MCP, with the account's connection token (made again when it no longer works).
  const tokenText = await mcpToken(n);
  if (tokenText) {
    const mcp = `${URL_}/functions/v1/mcp`;
    let sessionID: string | null = null, id = 0;
    const rpc = (method: string, params: unknown) => fetch(mcp, { method: "POST", headers: { authorization: `Bearer ${tokenText}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", ...(sessionID ? { "mcp-session-id": sessionID } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
    const call = (name: string, args: unknown) => rpc("tools/call", { name, arguments: args });
    let fetchID = "";
    for (let i = 0; i < repeat; i++) {
      sessionID = null;
      await time("mcp initialize", async () => { const r = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "release-gate", version: "1" } }); sessionID = r.headers.get("mcp-session-id"); return r; });
      await time("mcp list", () => call("list", {}));
      await time("mcp search", async () => {
        const r = await call("search", { query: "lisbon deposit" });
        const j = await r.clone().json().catch(() => null);
        const text = j?.result?.content?.[0]?.text ?? "";
        try { fetchID ||= JSON.parse(text).results?.[0]?.path ?? JSON.parse(text).results?.[0]?.id ?? ""; } catch { /* not JSON */ }
        return r;
      });
      await time("mcp fetch", () => call("fetch", { id: fetchID || "Archive/Apartment hunt.md" }));
      await time("mcp edit", () => call("edit", { path: fetchID || "Archive/Apartment hunt.md", old_string: i % 2 ? "2 months' rent!" : "2 months' rent.", new_string: i % 2 ? "2 months' rent." : "2 months' rent!" }));
    }
  }
  for (const [k, v] of Object.entries(out) as [string, unknown][]) {
    const r = v as { ms: number[]; errors: number };
    out[k] = { p50: pct(r.ms, 0.5), p95: pct(r.ms, 0.95), errors: r.errors };
  }
  return { account: n, repeat, mcp: Boolean(tokenText), calls: out };
}

/** The account's MCP token from .secrets, or a new one from the OAuth flow a directory client runs
 *  (scripts/review-account.py `connect`, on staging's MCP server) when it's missing or refused. */
async function mcpToken(n: number): Promise<string> {
  const path = `${SECRETS}/staging-bench-${n}-token.txt`;
  const mcp = `${URL_}/functions/v1/mcp`;
  const works = async (t: string) => {
    const r = await fetch(mcp, { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "release-gate", version: "1" } } }) });
    await r.body?.cancel();
    return r.ok;
  };
  const saved = await Deno.readTextFile(path).then((t) => t.trim(), () => "");
  if (saved && await works(saved)) return saved;
  if (!mcp.startsWith(`https://${REF}.supabase.co/`)) throw new Error("not staging's MCP server");
  const py = `import importlib.util, os, sys
spec = importlib.util.spec_from_file_location("ra", sys.argv[1]); ra = importlib.util.module_from_spec(spec); spec.loader.exec_module(ra)
t = ra.connect(ra.Account())
fd = os.open(sys.argv[2], os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600); os.write(fd, (t + "\\n").encode()); os.close(fd)`;
  const out = await new Deno.Command("python3", { args: ["-c", py, `${ROOT}/scripts/review-account.py`, path], stdout: "null", stderr: "piped",
    env: { AMBER_REVIEW_SECRETS: file(n), AMBER_BACKEND_CONFIG: `${ROOT}/Config/Backend.staging.local.xcconfig`, AMBER_MCP_URL: mcp } }).output();
  if (!out.success) return "";
  return (await Deno.readTextFile(path)).trim();
}

async function advisors() {
  const out: Record<string, unknown> = {};
  for (const kind of ["security", "performance"]) {
    const lints = ((await api("GET", `/v1/projects/${REF}/advisors/${kind}`)).lints ?? []) as { name: string; level: string; detail: string }[];
    const counts: Record<string, number> = {};
    for (const l of lints) counts[`${l.level} ${l.name}`] = (counts[`${l.level} ${l.name}`] ?? 0) + 1;
    out[kind] = { total: lints.length, errors: lints.filter((l) => l.level === "ERROR").length, warnings: lints.filter((l) => l.level === "WARN").length, counts,
      errorDetails: lints.filter((l) => l.level === "ERROR").map((l) => l.detail.slice(0, 200)) };
  }
  return out;
}

const [cmd, ...rest_] = Deno.args;
const nums = rest_.map(Number);
const result = cmd === "ensure" ? await ensure(nums[0])
  : cmd === "creds" ? await creds(nums[0])
  : cmd === "arrive" ? await arrive(nums[0])
  : cmd === "rls" ? await rls(nums[0], nums[1])
  : cmd === "plaintext" ? await plaintext()
  : cmd === "bytes" ? await bytes(nums)
  : cmd === "latency" ? await latency(nums[0], nums[1] || 20)
  : cmd === "advisors" ? await advisors()
  : (() => { throw new Error("ensure | creds | arrive | rls | plaintext | bytes | latency | advisors"); })();
console.log(JSON.stringify(result));
