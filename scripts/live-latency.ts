// Measures how fast an edit on one device reaches another, on the LOCAL Supabase stack:
// device A saves a note the way the app pushes while you type (every 0.35 s), device B
// listens on realtime like the app does, and we time each edit from A's save to B's receipt.
//   deno run -A scripts/live-latency.ts [edits]
// Refuses to run against anything but 127.0.0.1.
import { createClient } from "npm:@supabase/supabase-js@2";
import postgres from "npm:postgres@3.4.5";

const status = new TextDecoder().decode((await new Deno.Command("supabase", { args: ["status", "-o", "env"], stderr: "null" }).output()).stdout);
const env = Object.fromEntries(status.split("\n").filter((l) => l.includes("=")).map((l) => {
  const i = l.indexOf("=");
  return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
}));
const api = env.API_URL, anon = env.ANON_KEY;
if (!api || !/^http:\/\/127\.0\.0\.1:/.test(api)) throw new Error(`Not a local stack: ${api}. Run supabase start.`);

const edits = Number(Deno.args[0] ?? 40);
const email = `live-${Date.now()}@example.com`, password = "live-latency-password-1";
// A local stack started before sign-ups opened still runs the allowlist hook.
const sql = postgres(env.DB_URL, { max: 1, prepare: false });
await sql`insert into public.signup_allowlist (email) values (${email}) on conflict do nothing`.catch(() => {});
await sql.end();
const a = createClient(api, anon, { auth: { persistSession: false } });
const signup = await a.auth.signUp({ email, password });
if (signup.error) throw signup.error;
const b = createClient(api, anon, { auth: { persistSession: false } });
const signin = await b.auth.signInWithPassword({ email, password });
if (signin.error) throw signin.error;
await b.realtime.setAuth(signin.data.session!.access_token);

const id = crypto.randomUUID();
const now = () => new Date().toISOString();
{
  const { error } = await a.from("notes").insert({ id, body: "Live\n", created_at: now(), updated_at: now() });
  if (error) throw error;
}

const sentAt = new Map<string, number>();
const latencies: number[] = [];
let withBody = 0, received = 0;
const ready = Promise.withResolvers<void>();
const channel = b.channel("live-latency")
  .on("postgres_changes", { event: "*", schema: "public", table: "notes" }, (p) => {
    const body = (p.new as { body?: string }).body;
    received++;
    if (body !== undefined) withBody++;
    const t = body ? sentAt.get(body) : undefined;
    if (t !== undefined) { latencies.push(performance.now() - t); sentAt.delete(body!); }
  })
  .subscribe((s) => { if (s === "SUBSCRIBED") ready.resolve(); });
await ready.promise;
await new Promise((r) => setTimeout(r, 500));

let text = "Live\n";
const pushes: number[] = [];
for (let i = 0; i < edits; i++) {
  text += `word${i} `;
  const t0 = performance.now();
  sentAt.set(text, t0);
  const { error } = await a.from("notes").update({ body: text, updated_at: now() }).eq("id", id);
  if (error) throw error;
  pushes.push(performance.now() - t0);
  await new Promise((r) => setTimeout(r, 350));
}
await new Promise((r) => setTimeout(r, 1500));
await b.removeChannel(channel);
await a.from("notes").delete().eq("id", id);

const pct = (xs: number[], p: number) => { const s = [...xs].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const fmt = (x: number) => `${x.toFixed(0)} ms`;
console.log(`edits ${edits}, realtime events ${received}, with the full row ${withBody}, timed ${latencies.length}`);
if (sentAt.size) console.log(`never arrived: edits ${[...sentAt.keys()].map((t) => t.trim().split(" ").length - 1).sort((x, y) => x - y).join(", ")}`);
console.log(`push (save to server): p50 ${fmt(pct(pushes, 0.5))}, p95 ${fmt(pct(pushes, 0.95))}`);
console.log(`save to other device:  p50 ${fmt(pct(latencies, 0.5))}, p95 ${fmt(pct(latencies, 0.95))}, max ${fmt(Math.max(...latencies))}`);
Deno.exit(0);
