// Password reset end to end, against the LOCAL Supabase stack (scripts/password-reset-e2e.sh runs it).
// The site's own code does each step: the request route (web/app/reset-password/request/route.ts) and
// the page's save (web/lib/password-reset.ts). The email comes from the local mail catcher. With
// RESET_SITE set (the site built and served against the same stack) the link is also opened the way mail
// scanners do: fetched, and loaded in headless Chrome, which runs the page's scripts.
//
// What it holds: opening the link spends nothing; Save does; the new password signs in and the old one
// doesn't; the account's key row, its notes and its AI connection are byte for byte what they were.
import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import postgres from "npm:postgres@3.4.5";
import { POST as requestRoute } from "../web/app/reset-password/request/route.ts";
import { authAPI, newPending, readResetLink, savePassword } from "../web/lib/password-reset.ts";

const API = Deno.env.get("PANE_API")!;
const ANON = Deno.env.get("PANE_ANON")!;
const MAIL = Deno.env.get("PANE_MAIL")!;
const SITE = Deno.env.get("RESET_SITE");
const db = postgres(Deno.env.get("PANE_DB")!, { max: 1, prepare: false });
const tag = crypto.randomUUID().slice(0, 8);
const email = `reset-${tag}@example.com`;
const OLD = "the old password, long enough";
const NEW = "a brand new password, also long";
const KEY_ID = "0123456789abcdef";

const auth = authAPI(API, ANON);
const headers = { apikey: ANON, authorization: `Bearer ${ANON}`, "content-type": "application/json" };

async function signIn(password: string) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, { method: "POST", headers, body: JSON.stringify({ email, password }) });
  const body = await r.json();
  return r.ok ? body as { access_token: string; refresh_token: string } : null;
}

async function refresh(token: string) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers, body: JSON.stringify({ refresh_token: token }) });
  await r.body?.cancel();
  return r.ok;
}

const rpc = async (session: string, fn: string, args: unknown) => {
  const r = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: "POST", headers: { ...headers, authorization: `Bearer ${session}` }, body: JSON.stringify(args) });
  assert(r.ok, `${fn}: ${r.status} ${await r.clone().text()}`);
  return r.json();
};

const askForLink = (address: string) => {
  Deno.env.set("SUPABASE_URL", API);
  Deno.env.set("SUPABASE_ANON_KEY", ANON);
  return requestRoute(new Request("https://ambernotes.app/reset-password/request", {
    method: "POST", headers: { origin: "https://ambernotes.app", host: "ambernotes.app", "content-type": "application/json" },
    body: JSON.stringify({ email: address }),
  }));
};

async function mailTo(address: string) {
  for (let i = 0; i < 40; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`)).json();
    if (list.messages?.length) return (await fetch(`${MAIL}/api/v1/message/${list.messages[0].ID}`)).json() as Promise<{ Subject: string; HTML: string; Text: string }>;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

/// Opens a page in headless Chrome, as Safe Links does, waits for its scripts, and reads what it shows.
async function inChrome(url: string) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const chrome = new Deno.Command("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", {
    args: ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${await Deno.makeTempDir()}`, url],
    stdout: "null", stderr: "null",
  }).spawn();
  try {
    await new Promise((r) => setTimeout(r, 6000));
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
    const ws = new WebSocket(targets.find((t) => t.type === "page")!.webSocketDebuggerUrl);
    await new Promise((r) => ws.onopen = r);
    const answer = new Promise<{ result: { result: { value: string } } }>((r) => ws.onmessage = (e) => r(JSON.parse(e.data)));
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { returnByValue: true, expression: "JSON.stringify({ text: document.body.innerText, hydrated: Object.keys(document.querySelector('form') ?? {}).some((k) => k.startsWith('__react')) })" } }));
    const value = JSON.parse((await answer).result.result.value) as { text: string; hydrated: boolean };
    ws.close();
    return value;
  } finally {
    chrome.kill();
    await chrome.status;
  }
}

/// Everything a reset must leave alone, as text.
async function snapshot(uid: string) {
  const [keys] = await db`select row_to_json(k)::text as v from public.account_keys k where user_id = ${uid}`;
  const notes = await db`select id, body_ct, head_ct, version, updated_at from public.notes where user_id = ${uid} order by id`;
  const tokens = await db`select id, token_hash, dk_wrap, revoked_at from public.mcp_tokens where user_id = ${uid} order by id`;
  return JSON.stringify({ keys: keys?.v, notes, tokens });
}

const recoveryTokens = async (uid: string) =>
  Number((await db`select count(*)::int as n from auth.one_time_tokens where user_id = ${uid} and token_type = 'recovery_token'`)[0].n);

Deno.test({ name: "password reset end to end", sanitizeResources: false, sanitizeOps: false, fn: async (t) => {
  const [{ id: uid }] = await db`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token,
                            raw_app_meta_data, raw_user_meta_data)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${email}, crypt(${OLD}, gen_salt('bf')), now(), now(), now(),
            '', '', '', '', '', '', '{"provider":"email","providers":["email"]}', '{}')
    returning id`;
  try {
    // A device: signed in, the account's key made, a note and an AI connection.
    const device = await signIn(OLD);
    assert(device, "the old password signs in before the reset");
    await rpc(device.access_token, "create_account_key", { p_key_id: KEY_ID, p_verifier: "ab".repeat(32), p_recovery_wrap: `amb2.${KEY_ID}.d3JhcA`, p_generation: 0 });
    await db`insert into public.notes (id, user_id, body_ct, head_ct) values (gen_random_uuid(), ${uid}, ${`amb2.${KEY_ID}.Ym9keQ`}, ${`amb2.${KEY_ID}.aGVhZA`})`;
    await rpc(device.access_token, "create_mcp_token", { token_name: "Claude", write_access: true, token_hash: "cd".repeat(32), dk_wrap: `amb2.${KEY_ID}.d3JhcDI` });
    const before = await snapshot(uid);
    assertMatch(before, /amb2\./);

    let link = "";
    await t.step("asking answers the same for an account and for nobody, and the account gets the email", async () => {
      const mine = await askForLink(email);
      const nobody = await askForLink(`nobody-${tag}@example.com`);
      assertEquals([mine.status, await mine.json()], [200, { sent: true }]);
      assertEquals([nobody.status, await nobody.json()], [200, { sent: true }]);
      // A second ask inside the minute: Supabase refuses it for a known address; the answer doesn't change.
      const again = await askForLink(email);
      assertEquals([again.status, await again.json()], [200, { sent: true }]);
      const mail = await mailTo(email);
      assert(mail, "the reset email arrived");
      assertEquals(mail.Subject, "Reset your Amber Notes password");
      assertEquals(await mailTo(`nobody-${tag}@example.com`), null);
      const hrefs = [...mail.HTML.matchAll(/href="([^"]+reset-password[^"]+)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));
      assert(hrefs.length >= 2 && hrefs.every((h) => h === hrefs[0]), "every link in the email is the same");
      link = hrefs[0];
      assertMatch(link, /\/reset-password\?token_hash=[0-9a-f]{20,}&type=recovery$/);
      assertEquals(await recoveryTokens(uid), 1);
    });

    await t.step("opening the link spends nothing", async () => {
      if (SITE) {
        const url = new URL(link);
        const local = `${SITE}${url.pathname}${url.search}`;
        // A scanner that fetches the address, then one that runs the page in a browser.
        const page = await fetch(local);
        assertEquals(page.status, 200);
        assertMatch(await page.text(), /Choose a new password/);
        const shown = await inChrome(local);
        assertMatch(shown.text, /Choose a new password/);
        assert(shown.hydrated, "the page's scripts ran, as in a scanner's browser");
      } else {
        console.log("  (RESET_SITE not set: the browser scanner step was skipped)");
      }
      assertEquals(await recoveryTokens(uid), 1, "the token is still there after the link was opened");
    });

    await t.step("Save spends the link and sets the password; the old one stops working", async () => {
      const read = readResetLink(new URL(link).searchParams, new URLSearchParams());
      assert(read.kind === "token");
      const pending = newPending(read.tokenHash);
      assertEquals(await savePassword(pending, "too short", auth), { kind: "error", message: "Use at least 12 characters." });
      assertEquals(await recoveryTokens(uid), 1, "a refused password didn't spend the link");
      assertEquals(await savePassword(pending, NEW, auth), { kind: "done" });
      assertEquals(await recoveryTokens(uid), 0);
      assert(await signIn(NEW), "the new password signs in");
      assertEquals(await signIn(OLD), null, "the old password is refused");
    });

    await t.step("the link works once", async () => {
      const read = readResetLink(new URL(link).searchParams, new URLSearchParams());
      assert(read.kind === "token");
      assertEquals(await savePassword(newPending(read.tokenHash), `${NEW} again`, auth), { kind: "expired" });
      assert(await signIn(NEW), "the password is still the one just set");
    });

    await t.step("the key, the notes and the AI connection are untouched", async () => {
      assertEquals(await snapshot(uid), before);
    });

    await t.step("a device signed in before the reset is signed out (Supabase ends every other session)", async () => {
      assertEquals(await refresh(device.refresh_token), false);
    });

    await t.step("the session the link opened was ended", async () => {
      // Only the two sign-ins with the new password above: the device's session and the link's are gone.
      const sessions = await db`select count(*)::int as n from auth.sessions where user_id = ${uid}`;
      assertEquals(sessions[0].n, 2);
      const fromLink = await db`select count(*)::int as n from auth.sessions s join auth.mfa_amr_claims c on c.session_id = s.id
                                where s.user_id = ${uid} and c.authentication_method = 'recovery'`;
      assertEquals(fromLink[0].n, 0);
    });
  } finally {
    await db`delete from auth.users where id = ${uid}`;
    await db.end();
  }
} });
