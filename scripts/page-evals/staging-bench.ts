// The file tools' latency on a hosted server (staging), on accounts of different sizes.
//   seed:  deno run -A scripts/page-evals/staging-bench.ts seed <account secrets file> <notes>
//          signs in as that account (public API, row-level security), opens its key from the saved
//          recovery key and adds notes in nested folders, sub-notes, 3 apps and 10 file rows, sealed
//          here as the apps seal them. Adds only what's missing (by a marker folder).
//   bench: deno run -A scripts/page-evals/staging-bench.ts bench <MCP url> <token file> [--repeat 5]
//          times list, fetch, search and edit, with the server's Server-Timing parts.
// Secrets are read from files and never printed. Backend: AMBER_BACKEND_CONFIG (an xcconfig).
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import "../../supabase/functions/mcp/tools.ts";
import { parseRecoveryKey, recoveryKEK, unwrap, Vault, verifierOf } from "../../supabase/functions/_shared/e2ee.ts";
import { previewOf, titleOf } from "../../supabase/functions/mcp/notes.ts";
import { scaffold } from "../../supabase/functions/mcp/app_scaffold.ts";
import { withFiles } from "../../supabase/functions/mcp/app_files.ts";
import { linkProject, serialize } from "../../supabase/functions/mcp/app_project.ts";

const args = parseArgs(Deno.args, { string: ["repeat"] });
const [cmd, a1, a2] = args._.map(String);

const WORDS = "meeting budget invoice lisbon deposit apartment client roadmap sprint review recipe running coffee design hiring travel plan notes ideas draft".split(" ");
const pick = (i: number, k: number) => WORDS[(i * 7 + k * 13) % WORDS.length];
/** About 1.5 KB of text, like a real note. */
const body = (i: number) => `Note ${i} ${pick(i, 0)}\n\n## ${pick(i, 1)}\n\n` + Array.from({ length: 20 + (i % 40) }, (_, k) => `- ${pick(i, k)} ${pick(i, k + 3)} with ${pick(i, k + 5)} ${i * k % 997} ${k % 5 === 0 ? "- [ ] todo" : ""}`).join("\n");

if (cmd === "seed") await seed(a1, Number(a2));
else if (cmd === "bench") await bench(a1, a2, Number(args.repeat ?? 5));
else throw new Error("seed <secrets> <n> | bench <url> <token file>");

async function seed(secretsFile: string, n: number) {
  const cfg = await Deno.readTextFile(Deno.env.get("AMBER_BACKEND_CONFIG")!);
  const val = (k: string) => cfg.match(new RegExp(`^${k}\\s*=\\s*(.+)$`, "m"))![1].trim();
  const url = val("PANE_SUPABASE_URL").replace("https:/$()/", "https://"), anon = val("PANE_SUPABASE_KEY");
  const sec = await Deno.readTextFile(secretsFile);
  const email = sec.match(/Email:\s*(\S+)/)![1], password = sec.match(/Password:\s*(.+)/i)![1].trim(), recovery = sec.match(/^Recovery key:\s*(\S.*?)\s*$/mi)![1];
  const auth = await (await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: anon, "content-type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  if (!auth.access_token) throw new Error("sign-in failed");
  const user = auth.user.id as string;
  const headers = { apikey: anon, authorization: `Bearer ${auth.access_token}`, "content-type": "application/json", "x-pane-device": "Mac", "x-amber-client": "lock-aware/1 e2ee/1" };
  const rest = async (method: string, path: string, data?: unknown): Promise<unknown> => {
    const r = await fetch(`${url}/rest/v1/${path}`, { method, headers: { ...headers, prefer: "return=minimal" }, ...(data ? { body: JSON.stringify(data) } : {}) });
    // The account's write bucket: wait for it to refill, then go on.
    if (r.status === 429) { await r.body?.cancel(); await new Promise((ok) => setTimeout(ok, 10_000)); return await rest(method, path, data); }
    if (!r.ok) throw new Error(`${method} ${path.split("?")[0]}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.status === 204 || r.status === 201 ? null : await r.json();
  };
  const state = await (await fetch(`${url}/rest/v1/rpc/account_key_state`, { method: "POST", headers, body: "{}" })).json();
  const key = state.key;
  const dk = await unwrap(key.recovery_wrap, await recoveryKEK((await parseRecoveryKey(recovery))!, user), "recovery", user);
  if (await verifierOf(dk, user) !== key.verifier) throw new Error("the recovery key doesn't match");
  const v = await Vault.from(dk, user);
  const have = await (await fetch(`${url}/rest/v1/notes?select=id&deleted_at=is.null`, { headers: { ...headers, prefer: "count=exact", range: "0-0" } })).headers.get("content-range");
  const count = Number(have?.split("/")[1] ?? 0);
  if (count >= n) return console.log(`already ${count} notes`);
  // Tops up an account that has some already.
  n -= count;
  const t0 = performance.now();
  // Folders: ~n/25, three deep.
  const nf = Math.max(4, Math.round(n / 25));
  const folders: { id: string; name_ct: string; parent_id: string | null; sort_index: number }[] = [];
  for (let i = 0; i < nf; i++) {
    const id = crypto.randomUUID();
    folders.push({ id, name_ct: await v.sealFolder(id, `Folder ${i}`), parent_id: i < 8 ? null : folders[(i * 3) % Math.min(i, 40)].id, sort_index: i });
  }
  for (let i = 0; i < folders.length; i += 200) await rest("POST", "folders", folders.slice(i, i + 200));
  const ids: string[] = [];
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const id = crypto.randomUUID();
    ids.push(id);
    const b = body(i);
    rows.push({ id, body_ct: await v.sealBody(id, b), head_ct: await v.sealHead(id, { title: titleOf(b), preview: previewOf(b) }), folder_id: folders[i % nf].id, parent_id: null, is_pinned: i % 97 === 0 });
  }
  // One note to find among them all.
  { const id = crypto.randomUUID(); const b = "Apartment hunt\n\nLisbon apartment: the deposit is 2 months' rent.\n"; ids.push(id); rows.push({ id, body_ct: await v.sealBody(id, b), head_ct: await v.sealHead(id, { title: titleOf(b), preview: previewOf(b) }), folder_id: folders[nf - 1].id, parent_id: null, is_pinned: false }); }
  // Sub-notes: every 20th note under the one before it.
  for (let i = 19; i < n; i += 20) rows[i].parent_id = ids[i - 1];
  const parents = rows.filter((r) => !r.parent_id), children = rows.filter((r) => r.parent_id);
  for (const set of [parents, children]) for (let i = 0; i < set.length; i += 200) await rest("POST", "notes", set.slice(i, i + 200));
  const project = serialize((await linkProject(await withFiles({ amberApp: 1, files: {}, compiled: {} }, scaffold("Habits")))).project);
  for (let k = 0; k < 3; k++) await rest("POST", "note_pages", { note_id: ids[k + 1], page_ct: await v.sealPage(ids[k + 1], project) });
  console.log(`seeded ${n} notes, ${nf} folders, ${children.length} sub-notes, 3 apps in ${Math.round((performance.now() - t0) / 1000)} s`);
}

async function bench(url: string, tokenFile: string, repeat: number) {
  const token = (await Deno.readTextFile(tokenFile)).trim();
  let session: string | null = null, n = 0;
  const rpc = async (method: string, params: unknown, cold = false) => {
    const t = performance.now();
    const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json", "mcp-protocol-version": "2025-06-18", ...(session ? { "mcp-session-id": session } : {}), ...(cold ? { "x-amber-cold": "1" } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params }) });
    const ms = performance.now() - t;
    session = res.headers.get("mcp-session-id") ?? session;
    const timing = Object.fromEntries((res.headers.get("server-timing") ?? "").split(",").filter(Boolean).map((p) => { const [k, d] = p.trim().split(";dur="); return [k, Number(d)]; }));
    const j = await res.json();
    return { ms, timing, j, status: res.status, region: res.headers.get("x-amber-region") };
  };
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "staging-bench", version: "1" } });
  const call = async (name: string, a: Record<string, unknown>, cold = false) => {
    const r = await rpc("tools/call", { name, arguments: a }, cold);
    const text = r.j.result?.content?.[0]?.text ?? JSON.stringify(r.j.error ?? r.j);
    return { ...r, text, error: r.j.result?.isError === true || r.status !== 200 };
  };
  const parse = (t: string) => { try { return JSON.parse(t); } catch { return {}; } };
  // The one note to find (accounts seeded before it existed get it here; "already exists" is fine).
  await call("create", { path: "Archive/Apartment hunt.md", content: "Lisbon apartment: the deposit is 2 months' rent." });
  // The older tools have no glob: find the note by searching for it instead.
  const g = parse((await call("list", { pattern: "**/Note 3 *.md" })).text).matches?.[0]?.path
    ?? parse((await call("search", { query: "\"Note 3 " + pick(3, 0) + "\"" })).text).results?.find((x: { title: string }) => x.title.startsWith("Note 3 "))?.path ?? "Note 3.md";
  const app = parse((await call("list", { pattern: "**/*.app" })).text).matches?.[0]?.path ?? "";
  const top = g.split("/")[0] + "/";
  // The indexes fill as they're used (a search indexes up to 2,000 notes): fill them first.
  for (let i = 0; i < 30; i++) { const r = await call("search", { pattern: "zzzqqq" }); if (!/searched/.test(r.text) && !r.error) break; }
  const ops: [string, string, Record<string, unknown>][] = [
    ["list root", "list", {}],
    ["list deep folder", "list", { path: g.split("/").slice(0, -1).join("/") + "/" }],
    ["list glob **/*.md", "list", { pattern: "**/*.md", limit: 100 }],
    ["fetch note", "fetch", { id: g }],
    ["fetch app file", "fetch", { id: `${app}src/App.tsx` }],
    ["search ranked", "search", { query: "lisbon deposit" }],
    ["search grep", "search", { pattern: "deposit", output: "files" }],
    ["search grep scoped", "search", { pattern: "todo", path: top, output: "count" }],
    ["search grep rare", "search", { pattern: "months' rent", output: "content" }],
    ["search ranked rare", "search", { query: "apartment hunt" }],
    ["edit note", "edit", { path: g, old_string: `## ${pick(3, 1)}\n`, new_string: `## ${pick(3, 1)}!\n` }],
  ];
  const rows = new Map<string, { cold: number[]; warm: number[]; coldTotal: number[]; warmTotal: number[]; parts: Record<string, number>; err?: string }>();
  let lastFetch = "";
  for (let r = 0; r < repeat; r++) {
    for (const [label, name, x] of ops) {
      // Every other round with the title cache bypassed (x-amber-cold, honoured only when AMBER_BENCH=1).
      const cold = r % 2 === 0;
      // The edit changes the heading the fetch just read, back and forth.
      let xx = x;
      if (label === "edit note") {
        const line = (lastFetch.split("\n")[2] ?? "").replace(/^ *\d+\t/, "");
        xx = { ...x, old_string: line, new_string: line.endsWith("!") ? line.slice(0, -1) : line + "!" };
      }
      const res = await call(name, xx, cold);
      if (label === "fetch note") lastFetch = parse(res.text).text ?? "";
      const row = rows.get(label) ?? rows.set(label, { cold: [], warm: [], coldTotal: [], warmTotal: [], parts: {} }).get(label)!;
      (cold ? row.cold : row.warm).push(res.ms);
      if (res.timing.total !== undefined) (cold ? row.coldTotal : row.warmTotal).push(res.timing.total);
      if (cold && r === 0) row.parts = res.timing;
      if (res.error) row.err = res.text.slice(0, 80);
    }
  }
  const med = (xs: number[]) => xs.length ? Math.round([...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]) : NaN;
  console.log("op".padEnd(22), "wall: no index".padStart(15), "index".padStart(7), "  server: no index".padStart(19), "index".padStart(7), "  parts without the index");
  for (const [label, r] of rows) {
    const p = r.parts;
    console.log(label.padEnd(22), String(med(r.cold)).padStart(15), String(med(r.warm)).padStart(7), String(med(r.coldTotal)).padStart(19), String(med(r.warmTotal)).padStart(7),
      `  db ${p.paths_db ?? "-"} ms, ${p.paths_opened ?? 0} titles ${p.paths_open ?? 0} ms, build ${p.paths_build ?? 0} ms${p.search_notes ? `, ${p.search_notes} texts ${p.search_open} ms` : ""} ${r.err ? `  ERR ${r.err}` : ""}`);
  }
}
