// End-to-end check of the first-run setup state and the adoption measure, on the LOCAL stack.
//   deno run -A scripts/setup-e2e.ts
// Creates two throwaway users in SQL, acts as each (role authenticated + JWT claims), and
// removes them at the end. Refuses anything but 127.0.0.1.
import postgres from "npm:postgres@3.4.5";

const out = new TextDecoder().decode((await new Deno.Command("supabase", { args: ["status", "-o", "env"], stderr: "null" }).output()).stdout);
const url = out.split("\n").find((l) => l.startsWith("DB_URL="))?.slice(7).replace(/^"|"$/g, "");
if (!url || !url.includes("127.0.0.1")) throw new Error("No local stack. Run supabase start.");
const db = postgres(url, { prepare: false, max: 1 });

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` → ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}

async function makeUser(daysAgo = 0) {
  const id = crypto.randomUUID();
  const email = `setup-e2e-${id.slice(0, 8)}@example.com`;
  await db`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', ${id}, 'authenticated', 'authenticated', ${email}, '', now(),
      '{"provider":"email","providers":["email"]}', '{}', now() - make_interval(days => ${daysAgo}), now(), '', '', '', '')`;
  return id;
}

// Runs `fn` inside a transaction as `uid` (or as the service role when uid is null).
async function as<T>(uid: string | null, fn: (tx: postgres.TransactionSql) => Promise<T>, source?: string): Promise<T> {
  return await db.begin(async (tx) => {
    if (uid) {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, true)`;
      await tx`set local role authenticated`;
    } else {
      await tx`set local role service_role`;
    }
    if (source) await tx`select set_config('pane.source', ${source}, true)`;
    return await fn(tx);
  }) as T;
}

const a = await makeUser();
const b = await makeUser();
try {
  const state = async (uid: string) => (await as(uid, (tx) => tx`select public.pane_setup_state() as s`))[0].s;

  let s = await state(a);
  check("fresh account: nothing done", !s.imported && !s.dismissed && !s.celebrated && !s.connected && s.ai_edits === 0, s);

  await as(a, (tx) => tx`select public.pane_setup_mark('imported')`);
  s = await state(a);
  check("mark imported", s.imported === true, s);

  let refused = false;
  try { await as(a, (tx) => tx`select public.pane_setup_mark('anything')`); } catch { refused = true; }
  check("unknown step refused", refused);

  await as(a, (tx) => tx`select public.create_mcp_token('Claude', true)`);
  s = await state(a);
  check("a connection counts as connected", s.connected === true, s);

  // An app edit doesn't count; an AI edit does (create and change).
  const noteId = crypto.randomUUID();
  await as(a, (tx) => tx`insert into public.notes (id, body) values (${noteId}, 'To-do')`);
  s = await state(a);
  check("app edit is not an AI edit", s.ai_edits === 0, s);
  await as(a, (tx) => tx`update public.notes set body = 'To-do\n\n- [ ] Call mom' where id = ${noteId}`, "mcp");
  await as(a, (tx) => tx`insert into public.notes (id, body) values (${crypto.randomUUID()}, 'From the AI')`, "mcp");
  s = await state(a);
  check("AI edits counted (update + create)", s.ai_edits === 2, s);

  const bSees = await as(b, (tx) => tx`select count(*)::int as n from public.pane_activity`);
  check("another account can't see the activity", bSees[0].n === 0, bSees);
  const bState = await state(b);
  check("another account's state is its own", bState.ai_edits === 0 && !bState.connected, bState);

  await as(a, (tx) => tx`select public.pane_setup_mark('celebrated')`);
  await as(a, (tx) => tx`select public.pane_setup_mark('dismissed')`);
  s = await state(a);
  check("celebrated and dismissed stick", s.celebrated && s.dismissed, s);

  // Devices: two installs of the same account.
  await as(a, (tx) => tx`select public.pane_seen_device(${crypto.randomUUID()}, 'macos')`);
  await as(a, (tx) => tx`select public.pane_seen_device(${crypto.randomUUID()}, 'ios')`);
  let devRefused = false;
  try { await as(a, (tx) => tx`select public.pane_seen_device(${crypto.randomUUID()}, 'windows')`); } catch { devRefused = true; }
  check("unknown platform refused", devRefused);
  let devicesDenied = false;
  try { await as(a, (tx) => tx`select count(*) from public.pane_devices`); } catch { devicesDenied = true; }
  check("devices aren't readable by the account", devicesDenied);

  // MVA: 10 AI edits on 3 days within 14 days, and 2 devices. Backdate a's activity across days.
  await db`delete from public.pane_activity where user_id = ${a}`;
  await db`insert into public.pane_activity (user_id, day, kind, n, first_at) values
    (${a}, (now() at time zone 'utc')::date, 'ai_edit', 4, now() + interval '2 hours'),
    (${a}, (now() at time zone 'utc')::date + 1, 'ai_edit', 3, now() + interval '26 hours'),
    (${a}, (now() at time zone 'utc')::date + 2, 'ai_edit', 3, now() + interval '50 hours')`;
  await db`update auth.users set created_at = now() where id = ${a}`;

  let denied = false;
  try { await as(a, (tx) => tx`select * from public.pane_adoption(4)`); } catch { denied = true; }
  check("accounts can't read adoption numbers", denied);

  const rows = await as(null, (tx) => tx`select * from public.pane_adoption(1)`);
  const week = rows[rows.length - 1];
  console.log("     adoption this week:", JSON.stringify(week));
  check("adoption counts a (MVR and MVA)", Number(week.mvr) >= 1 && Number(week.mva) >= 1, week);
} finally {
  await db`delete from auth.users where id in (${a}, ${b})`;
  await db.end();
}
console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) Deno.exit(1);
