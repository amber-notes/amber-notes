// Hammers the LOCAL stack the way an abusive or unlucky client would, and prints timings.
//   eval "$(deno run -A scripts/dev-user.ts)" && deno run -A scripts/stress.ts
// Refuses to run against anything but 127.0.0.1.
import postgres from "npm:postgres@3.4.5";

const api = Deno.env.get("PANE_API")!, anon = Deno.env.get("PANE_ANON")!, jwt = Deno.env.get("PANE_USER_JWT")!;
const mcp = Deno.env.get("PANE_MCP_URL")!, token = Deno.env.get("PANE_TOKEN")!, db = Deno.env.get("PANE_DB_URL")!;
if (!/^http:\/\/127\.0\.0\.1:/.test(api ?? "")) throw new Error("local stack only");
const sql = postgres(db, { max: 2, prepare: false });
const uid = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub;
const resetRate = () => sql`delete from public.pane_rate where user_id = ${uid}`;

async function rest(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  const res = await fetch(`${api}/rest/v1/${path}`, {
    method, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    headers: { authorization: `Bearer ${jwt}`, apikey: anon, "content-type": "application/json", prefer: "return=minimal", ...extra },
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function tool(name: string, args: Record<string, unknown>) {
  const res = await fetch(mcp, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  return await res.json();
}

async function timed<T>(label: string, f: () => Promise<T>): Promise<T> {
  const t = performance.now();
  const r = await f();
  console.log(`${label}: ${(performance.now() - t).toFixed(0)} ms`);
  return r;
}

const counts = (xs: number[]) => Object.entries(xs.reduce((m, s) => ({ ...m, [s]: (m[s] ?? 0) + 1 }), {} as Record<number, number>)).map(([k, v]) => `${k}×${v}`).join(" ");
async function pool<T>(n: number, width: number, f: (i: number) => Promise<T>) {
  const out: T[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: width }, async () => { while (next < n) { const i = next++; out[i] = await f(i); } }));
  return out;
}

try {
  await resetRate();
  const stamp = crypto.randomUUID().slice(0, 6);

  // 1. A burst of 1,000 new notes, 20 at a time (an import, or a script).
  const burst = await timed("1,000 notes, 20 in parallel", () =>
    pool(1000, 20, (i) => rest("POST", "notes", { id: crypto.randomUUID(), body: `Burst ${stamp} ${i}\n\nLine` }).then((r) => r.status)));
  console.log("  statuses:", counts(burst));

  // 2. 100 writers on one note at once (version guard and revision trigger under contention).
  const id = crypto.randomUUID();
  await rest("POST", "notes", { id, body: `Contended ${stamp}` });
  const storm = await timed("100 parallel writers on one note", () =>
    pool(100, 100, (i) => rest("PATCH", `notes?id=eq.${id}`, { body: `Contended ${stamp}\n\nwriter ${i}` }).then((r) => r.status)));
  console.log("  statuses:", counts(storm));
  const [row] = await sql`select version, (select count(*) from public.note_revisions where note_id = ${id})::int revs from public.notes where id = ${id}`;
  console.log(`  version ${row.version}, revisions kept ${row.revs}`);

  // 3. An update storm: 2,000 saves to one note as fast as one client can.
  await resetRate();
  const saves = await timed("2,000 sequential saves to one note", async () => {
    const s: number[] = [];
    for (let i = 0; i < 2000; i++) s.push((await rest("PATCH", `notes?id=eq.${id}`, { body: `Contended ${stamp}\n\n${"typing ".repeat(i % 50)}${i}` })).status);
    return s;
  });
  console.log("  statuses:", counts(saves));

  // 4. Past the rate: 7,000 tiny writes, 50 at a time.
  await resetRate();
  const flood = await timed("7,000 writes, 50 in parallel (past the 5,000 burst)", () =>
    pool(7000, 50, (i) => rest("PATCH", `notes?id=eq.${id}`, { is_pinned: i % 2 === 0 }).then((r) => r.status)));
  console.log("  statuses:", counts(flood));
  await resetRate();

  // 5. Bodies at and over the limit, and hostile text.
  const sizes: [string, string][] = [
    ["2 MB minus a bit", "Big\n" + "a".repeat(2 * 1024 * 1024 - 16)],
    ["5 MB", "Big\n" + "b".repeat(5 * 1024 * 1024)],
    ["1 MB, one line, no spaces", "x".repeat(1024 * 1024)],
    ["zalgo title", "Z" + "̶̷̸̡̢".repeat(2000) + "\nbody"],
    ["RTL override", "‮gnp.exe‬ and ⁦isolates⁩\nbody"],
    ["ZWJ family × 10k", "👨‍👩‍👧‍👦".repeat(10000)],
    ["100k emoji", "😀".repeat(100000)],
    ["NUL byte", "a\u0000b"],
  ];
  for (const [label, body] of sizes) {
    const r = await timed(`  write ${label}`, () => rest("POST", "notes", { id: crypto.randomUUID(), body }));
    console.log(`    → ${r.status} ${r.status >= 400 ? r.text.slice(0, 90) : ""}`);
  }
  const lone = await rest("POST", "notes", `{"id":"${crypto.randomUUID()}","body":"lone \\ud800 surrogate"}`);
  console.log(`  write lone surrogate → ${lone.status} ${lone.text.slice(0, 90)}`);

  // 6. Search: huge queries and wildcard-looking ones stay fast.
  for (const q of ["%", "_", ".*(a+)+$", "a".repeat(100_000), "Burst " + stamp, "‮", "😀"]) {
    const r = await timed(`  search ${JSON.stringify(q.slice(0, 16))}${q.length > 16 ? "…" : ""} (${q.length} chars)`, () =>
      rest("POST", "rpc/search_notes", { q, max_results: 20 }, { prefer: "return=representation" }));
    console.log(`    → ${r.status} ${r.status >= 400 ? r.text.slice(0, 80) : `${JSON.parse(r.text).length} results`}`);
  }

  // 7. MCP on big inputs: a 10,000-row table and a note near the limit.
  const rows = Array.from({ length: 10000 }, (_, i) => `| 2026-01-${String((i % 28) + 1).padStart(2, "0")} | ${i % 10} | ${i % 2 ? "Yes" : "No"} |`);
  const table = `Tracker ${stamp}\n\n<!-- pane-table: Date=date; Score=number; Done=choice Yes|No -->\n| Date | Score | Done |\n| --- | --- | --- |\n${rows.join("\n")}\n`;
  const created = await timed("  MCP create 10k-row table note", () => tool("create_note", { body: table }));
  const tid = created.result?.structuredContent?.created?.id;
  console.log(`    → ${created.result?.isError ? created.result.content[0].text.slice(0, 90) : "ok " + (table.length / 1024).toFixed(0) + " KB"}`);
  if (tid) {
    await timed("  MCP read_table (10k rows)", () => tool("read_table", { id: tid }));
    await timed("  MCP log_table_row (10k rows)", () => tool("log_table_row", { id: tid, values: { Date: "2026-02-01", Score: 7, Done: true } }));
    await timed("  MCP read_note (10k rows)", () => tool("read_note", { id: tid }));
  }
  await timed("  MCP search_notes 100k-char query", () => tool("search_notes", { query: "q".repeat(100_000) }));

  const [usage] = await sql`select notes, notes_bytes from public.pane_usage where user_id = ${uid}`;
  const [real] = await sql`select count(*) filter (where deleted_at is null)::int notes, coalesce(sum(octet_length(body)), 0)::bigint bytes from public.notes where user_id = ${uid}`;
  console.log(`usage counters: ${usage.notes} notes / ${usage.notes_bytes} bytes; actual ${real.notes} / ${real.bytes}${usage.notes === real.notes && BigInt(usage.notes_bytes) === BigInt(real.bytes) ? " (match)" : " (MISMATCH)"}`);
} finally {
  await resetRate();
  await sql.end();
}
