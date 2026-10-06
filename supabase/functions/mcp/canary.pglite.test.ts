// The canary test (security review): with end-to-end encryption, nothing a person writes may be
// stored or logged readably by the server, AI requests included. An account's note bodies, titles,
// folder names, file names, file contents and versions all carry a random canary; an AI connects
// through the real OAuth flow and runs every tool through the real request handler; then every row
// of every table and everything written to the console is searched for the canary. The only place
// it may appear is the public copy of a note shared on purpose, which proves the search works.
// The AI connects three ways: approved in the app, approved on a device for a browser elsewhere
// (the page asks with a commit to its key and nonce, the device writes its nonce, the page
// reveals its own, both show the number, the device seals the code and redirect to the page, the
// page picks it up with its pickup secret), and approved in the browser with the recovery key; tokens are refreshed too.
// The search looks for the canary as text, as hex, and as base64 (standard and URL-safe) at each
// of the three byte alignments it can have inside a longer encoded value.
// Needs no Docker or local stack:
//   cd supabase/functions/mcp && deno test -A canary.pglite.test.ts
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { fromBase64, handoffPayload, hex as toHex, matchCommit, matchNumber, newHandoffKeys, openHandoff, readHandoffPayload, sealHandoff, toBase64, tokenKey, wrap } from "../_shared/e2ee.ts";
import { schemaDB, sqlFor } from "./pglite.ts";
import { account, app, edit, file, lockedNote, note, notesPassword, folder, share, stubStorage } from "./sealed.ts";
import { tools } from "./tools.ts";

// The note-page tools are a prototype, served only with this setting.
Deno.env.set("AMBER_MCP_TOOLS", "pages");

const SUPA = "https://proj.supabase.co";
const FUNCTION = `${SUPA}/functions/v1/mcp`;
const CHATGPT = "https://chatgpt.com/connector_platform_oauth_redirect";
const SITE = "https://ambernotes.app";
Deno.env.set("SUPABASE_URL", SUPA);
Deno.env.set("SUPABASE_ANON_KEY", "anon");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
Deno.env.delete("MCP_PUBLIC_URL");
Deno.env.delete("MCP_ALIAS_URLS");
Deno.env.delete("CONNECT_PAGE_URL");

const { handleRequest } = await import("./server.ts");
const { sha256Hex } = await import("./oauth.ts");
const fromHex = (h: string) => new Uint8Array(h.match(/../g)!.map((b) => parseInt(b, 16)));

const CANARY = `canary-${crypto.randomUUID()}`;
const enc = new TextEncoder();
const randomHex = (n: number) => toHex(crypto.getRandomValues(new Uint8Array(n)));

/** The canary as it would read inside base64 (standard and URL-safe) of a longer value: encoded
 *  after 0, 1 and 2 bytes of something else, without the characters that also hold those bytes or
 *  what follows it. */
function base64Forms(text: string): string[] {
  const bytes = enc.encode(text);
  const forms: string[] = [];
  for (let k = 0; k < 3; k++) {
    const padded = new Uint8Array(k + bytes.length);
    padded.set(bytes, k);
    const b64 = toBase64(padded).replace(/=+$/, "");
    const inner = b64.slice(Math.ceil((8 * k) / 6), Math.floor((8 * (k + bytes.length)) / 6));
    forms.push(inner, inner.replace(/\+/g, "-").replace(/\//g, "_"));
  }
  return [...new Set(forms)];
}

Deno.test("no text of an encrypted account is stored or logged readably, whatever the AI does", async () => {
  // Everything written to the console from here on.
  const logged: string[] = [];
  const methods = ["log", "error", "warn", "info", "debug"] as const;
  const real = Object.fromEntries(methods.map((m) => [m, console[m]]));
  for (const m of methods) console[m] = (...args: unknown[]) => { logged.push(args.map((a) => (typeof a === "string" ? a : Deno.inspect(a))).join(" ")); };
  const realFetch = globalThis.fetch;
  try {
    const pg = await schemaDB();
    const sql = sqlFor(pg);
    const a = await account(pg);
    const lockKey = await notesPassword(pg, a);

    // MARK: The account, as the app writes it

    const travel = await folder(pg, a, `Travel ${CANARY}`);
    const ticket = await file(pg, a, `ticket-${CANARY}.txt`, "public.plain-text", enc.encode(`Ticket ${CANARY}\nSeat 12A`));
    const photo = await file(pg, a, `photo-${CANARY}.png`, "public.png", enc.encode(`PNG image ${CANARY}`));
    const scan = await file(pg, a, `scan-${CANARY}.pdf`, "com.adobe.pdf", enc.encode(`%PDF-1.4 ${CANARY}`));
    const tripBody = `Trip ${CANARY}\n\nPack the ${CANARY} bag.\n![ticket](pane-file:${ticket.id})\n\n## Log\n- day one`;
    const trip = await note(pg, a, tripBody, { folder: travel, pinned: true });
    const sub = await note(pg, a, `Sub ${CANARY}\n\nInside the trip`, { parent: trip, folder: travel });
    // Versions: the app's edit keeps the text before it.
    await edit(pg, a, trip, `${tripBody}\n[Sub ${CANARY}](pane-note:${sub})`);
    const trackerBody = `Tracker ${CANARY}\n\n<!-- pane-table: Date=date; Mood=scale 1-5; Note=text -->\n| Date | Mood | Note |\n| --- | --- | --- |\n| 2026-09-01 | 3 | ${CANARY} |\n\n- [ ] buy ${CANARY}\n- [ ] call`;
    const tracker = await note(pg, a, trackerBody, { folder: travel });
    await edit(pg, a, tracker, trackerBody + "\n", { "pane.source": "mcp", "pane.client": "Claude" });
    const locked = await lockedNote(pg, a, lockKey, `Locked ${CANARY}`);
    const sharedBody = `Shared ${CANARY}\n\nPublic ${CANARY}`;
    const shared = await note(pg, a, sharedBody);
    const shareLink = await share(pg, a, shared, { title: `Shared ${CANARY}`, body: sharedBody });
    assert(shareLink.slug);

    // MARK: Supabase Auth and Storage, faked

    const objects = new Map([ticket, photo, scan].map((f) => [f.path, f.sealed]));
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === `${SUPA}/auth/v1/user`) {
        const m = (new Headers(init?.headers).get("authorization") ?? "").match(/^Bearer jwt-([0-9a-f-]{36})$/);
        return Promise.resolve(m ? Response.json({ id: m[1] }) : Response.json({}, { status: 401 }));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    };
    const unstub = stubStorage(SUPA, objects);

    // MARK: Connecting an AI, as ChatGPT and the app do it

    const serve = (path: string, init: RequestInit = {}) =>
      handleRequest(new Request(`${FUNCTION}${path}`, { ...init, headers: { "cf-connecting-ip": "203.0.113.1", ...(init.headers ?? {}) } }), sql);
    const reg = await (await serve("/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "ChatGPT", redirect_uris: [CHATGPT] }) })).json();
    const start = async (state: string) => {
      const verifier = randomHex(48);
      const challenge = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier))))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const auth = await serve(`/authorize?${new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: CHATGPT, code_challenge: challenge, code_challenge_method: "S256", state, scope: "notes:read notes:write" })}`);
      return { verifier, requestId: new URL(auth.headers.get("location")!).searchParams.get("request")! };
    };
    const exchange = async (code: string, verifier: string) => await (await serve("/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: reg.client_id, code, code_verifier: verifier, redirect_uri: CHATGPT }),
    })).json();
    const { verifier, requestId } = await start("s");
    const session = { authorization: `Bearer jwt-${a.id}` };
    const described = await (await serve(`/connect/request?id=${requestId}`, { headers: session })).json();
    const code = "amb_code_" + randomHex(32);
    const decided = await (await serve("/connect/decide", {
      method: "POST", headers: { ...session, "content-type": "application/json" },
      body: JSON.stringify({ id: requestId, allow: true, write: true, redirect_uri: described.redirect_uri, code_hash: await sha256Hex(code),
        code_wrap: await wrap(a.dk, await tokenKey(code, "code"), "code", a.id) }),
    })).json();
    assertEquals(new URL(decided.redirect).searchParams.get("code"), null);
    const tokens = await exchange(code, verifier);
    assert(tokens.access_token, JSON.stringify(tokens));

    // MARK: Every tool, through the request handler

    let id = 0;
    const used = new Set<string>();
    // deno-lint-ignore no-explicit-any
    const rpc = async (method: string, params: Record<string, unknown> = {}, token = tokens.access_token): Promise<any> => {
      const res = await serve("", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
      assertEquals(res.status, 200);
      return (await res.json()).result;
    };
    // deno-lint-ignore no-explicit-any
    const tool = async (name: string, args: Record<string, unknown> = {}, ok = true): Promise<any> => {
      used.add(name);
      const r = await rpc("tools/call", { name, arguments: args });
      assertEquals(r.isError ?? false, !ok, `${name}: ${r.content?.[0]?.text}`);
      return ok ? r.structuredContent ?? r : r.content[0].text;
    };
    await rpc("initialize", { protocolVersion: "2025-06-18" });
    assert((await rpc("tools/list")).tools.length === tools.length);

    const overview = await tool("get_overview");
    assert(overview.folders.some((f: { path: string }) => f.path === `Travel ${CANARY}`));
    await tool("list_folders");
    await tool("list_notes");
    const byTitle = await tool("list_notes", { sort: "title", include_sub_notes: true });
    assert(byTitle.notes.some((n: { title: string; locked?: boolean }) => n.title === `Locked ${CANARY}` && n.locked));
    await tool("list_notes", { folder: `Travel ${CANARY}` });
    const found = await tool("search_notes", { query: CANARY });
    assert(found.results.some((r: { id: string; snippet: string }) => r.id === trip && r.snippet.includes(`«${CANARY}»`)), JSON.stringify(found));
    assert((await tool("search", { query: `"${CANARY} bag"` })).results.some((r: { id: string }) => r.id === trip));
    assertStringIncludes((await tool("read_note", { title: `Trip ${CANARY}` })).markdown, `Pack the ${CANARY} bag.`);
    assertStringIncludes(await tool("read_note", { title: `Missing ${CANARY}` }, false), "No note titled");
    assertStringIncludes(await tool("read_note", { id: locked }, false), "This note is locked");
    assertStringIncludes((await tool("fetch", { id: trip })).text, CANARY);
    assertEquals((await tool("read_table", { id: tracker })).rows[0].Note, CANARY);
    await tool("log_table_row", { id: tracker, values: { Date: "2026-09-02", Mood: 4, Note: `logged ${CANARY}` } });
    await tool("delete_table_row", { id: tracker, date: "2026-09-01" });
    await tool("set_checklist_item", { id: tracker, item: `buy ${CANARY}`, checked: true });
    await tool("edit_note", { id: trip, edits: [{ old_text: "day one", new_text: `day one ${CANARY}` }] });
    await tool("append_to_note", { id: trip, text: `- more ${CANARY}`, under_heading: "Log" });
    await tool("append_to_note", { id: shared, text: `Edited by an AI ${CANARY}` });
    await tool("replace_note_body", { id: sub, body: `Sub ${CANARY}\n\nRewritten ${CANARY}` });
    const created = (await tool("create_note", { body: `New ${CANARY}\n\nBody ${CANARY}`, folder: `Created ${CANARY}` })).created;
    await tool("create_sub_note", { id: trip, body: `Child ${CANARY}\n\nmore`, under_heading: "Log" });
    await tool("create_folder", { path: `Folder ${CANARY}/Inner ${CANARY}` });
    await tool("rename_folder", { folder: `Folder ${CANARY}`, new_name: `Renamed ${CANARY}` });
    await tool("move_note", { id: created.id, folder: `Renamed ${CANARY}` });
    await tool("pin_note", { id: tracker, pinned: true });
    const history = await tool("note_history", { id: trip });
    assert(history.revisions.length >= 2);
    assert(history.revisions.every((r: { title: string }) => r.title === `Trip ${CANARY}`));
    await tool("restore_revision", { id: trip, revision_id: history.revisions[history.revisions.length - 1].revision_id });
    const files = await tool("list_files", { query: CANARY });
    assertEquals(files.files.length, 3);
    assert(files.files.find((f: { id: string }) => f.id === ticket.id).in_notes.some((n: { id: string }) => n.id === trip));
    // Files come back inline: text as text, an image as an image, a PDF as an embedded resource.
    const text = await rpc("tools/call", { name: "get_file", arguments: { id: ticket.id } });
    used.add("get_file");
    assertEquals(text.content[1], { type: "text", text: `Ticket ${CANARY}\nSeat 12A` });
    const image = (await rpc("tools/call", { name: "get_file", arguments: { id: `pane-file:${photo.id}` } })).content[1];
    assertEquals([image.type, image.mimeType, atob(image.data)], ["image", "image/png", `PNG image ${CANARY}`]);
    const pdf = (await rpc("tools/call", { name: "get_file", arguments: { id: scan.id } })).content[1];
    assertEquals([pdf.type, pdf.resource.mimeType, atob(pdf.resource.blob), pdf.resource.uri], ["resource", "application/pdf", `%PDF-1.4 ${CANARY}`, `pane-file:${scan.id}`]);
    // A page is sealed like the note: the canary in it must not show anywhere either.
    await tool("set_note_page", { id: tracker, html: `<!doctype html><main>${CANARY}</main><script>amber.onChange(() => {})</script>` });
    assertStringIncludes((await tool("get_note_page", { id: tracker })).html, CANARY);
    await tool("edit_note_page", { id: tracker, edits: [{ old_text: `<main>${CANARY}`, new_text: `<main>edited ${CANARY}` }] });
    await tool("list_api_keys");
    await tool("delete_note", { id: created.id });
    await tool("restore_note", { id: created.id });
    await tool("delete_folder", { folder: `Created ${CANARY}` });
    assertEquals([...used].sort(), tools.map((t) => t.name).sort(), "every tool ran");

    // MARK: Connecting from a browser elsewhere, approved on a device

    const json = { "content-type": "application/json" };
    /** The page: a key pair for the handoff, a pickup secret and a nonce, then the ask with the
     *  commit to its key and nonce. */
    const pageAsks = async (id: string) => {
      const keys = await newHandoffKeys();
      const secret = crypto.getRandomValues(new Uint8Array(32));
      const nonce = crypto.getRandomValues(new Uint8Array(16));
      const res = await serve("/connect/ask", {
        method: "POST", headers: { ...session, origin: SITE, ...json },
        body: JSON.stringify({ id, browser_key: toBase64(keys.publicRaw), from: "Chrome on a Mac",
          pickup_hash: toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", secret))),
          match_commit: await matchCommit(keys.publicRaw, nonce) }),
      });
      assertEquals(res.status, 200);
      await res.body?.cancel();
      return { keys, pickup: toHex(secret), nonce };
    };
    const pickUp = async (id: string, pickup: string) =>
      await (await serve("/connect/status", { method: "POST", headers: json, body: JSON.stringify({ id, pickup }) })).json();

    const b = await start("b");
    const bPage = await pageAsks(b.requestId);
    // The device writes its nonce; the page sees it with its pickup and reveals its own.
    const deviceNonce = crypto.getRandomValues(new Uint8Array(16));
    const wrote = await serve("/connect/nonce", { method: "POST", headers: { ...session, ...json }, body: JSON.stringify({ id: b.requestId, nonce: toHex(deviceNonce) }) });
    assertEquals(wrote.status, 200);
    await wrote.body?.cancel();
    const asked = await pickUp(b.requestId, bPage.pickup);
    assertEquals([asked.state, asked.device_nonce], ["asked", toHex(deviceNonce)]);
    const revealed = await serve("/connect/reveal", { method: "POST", headers: json, body: JSON.stringify({ id: b.requestId, pickup: bPage.pickup, nonce: toHex(bPage.nonce) }) });
    assertEquals(revealed.status, 200);
    await revealed.body?.cancel();
    // The device: sees the ask, checks the commit, shows the same number as the page, reads the
    // request, builds the redirect, seals it with the code.
    const [seen] = await app(pg, a.id, `select browser_key, match_commit, page_nonce from public.connect_asks where request_id = $1`, [b.requestId]);
    assertEquals(await matchCommit(fromBase64(seen.browser_key), fromHex(seen.page_nonce)), seen.match_commit);
    assertEquals(await matchNumber(fromBase64(seen.browser_key), fromHex(seen.page_nonce), deviceNonce, b.requestId),
      await matchNumber(bPage.keys.publicRaw, bPage.nonce, fromHex(asked.device_nonce), b.requestId));
    const shown = await (await serve(`/connect/request?id=${b.requestId}`, { headers: session })).json();
    const back = new URL(shown.redirect_uri);
    if (shown.state) back.searchParams.set("state", shown.state);
    back.searchParams.set("iss", shown.iss);
    const bCode = "amb_code_" + randomHex(32);
    const bDecided = await (await serve("/connect/decide", {
      method: "POST", headers: { ...session, ...json },
      body: JSON.stringify({ id: b.requestId, allow: true, write: false, redirect_uri: shown.redirect_uri, code_hash: await sha256Hex(bCode),
        code_wrap: await wrap(a.dk, await tokenKey(bCode, "code"), "code", a.id),
        handoff: await sealHandoff(handoffPayload({ code: bCode, redirect: back.toString() }), fromBase64(seen.browser_key), b.requestId) }),
    })).json();
    assertEquals([bDecided.handoff, bDecided.redirect], [true, back.toString()]);
    // The page picks up once, opens the code and goes on to the AI.
    const picked = await pickUp(b.requestId, bPage.pickup);
    assertEquals(picked.state, "approved");
    const payload = readHandoffPayload(await openHandoff(picked.handoff, bPage.keys.privateKey, b.requestId));
    assertEquals(payload, { code: bCode, redirect: back.toString() });
    assertEquals((await pickUp(b.requestId, bPage.pickup)).state, "delivered");
    const bTokens = await exchange(payload.code, b.verifier);
    assert(bTokens.access_token, JSON.stringify(bTokens));
    assertStringIncludes((await rpc("tools/call", { name: "read_note", arguments: { id: trip } }, bTokens.access_token)).structuredContent.markdown, CANARY);

    // MARK: Approved in the browser with the recovery key (the page opens the key itself)

    const c = await start("c");
    const cPage = await pageAsks(c.requestId);
    const cCode = "amb_code_" + randomHex(32);
    const cDecided = await serve("/connect/decide", {
      method: "POST", headers: { ...session, origin: SITE, ...json },
      body: JSON.stringify({ id: c.requestId, allow: true, write: true, redirect_uri: CHATGPT, code_hash: await sha256Hex(cCode),
        code_wrap: await wrap(a.dk, await tokenKey(cCode, "code"), "code", a.id) }),
    });
    assertEquals(cDecided.status, 200);
    await cDecided.body?.cancel();
    assertEquals(await pickUp(c.requestId, cPage.pickup), { state: "delivered" });
    const cTokens = await exchange(cCode, c.verifier);
    assert(cTokens.access_token, JSON.stringify(cTokens));

    // MARK: Refreshing: the key moves to the new tokens, and the AI goes on

    for (const t of [tokens, bTokens, cTokens]) {
      const next = await (await serve("/token", {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token }),
      })).json();
      assert(next.access_token && next.refresh_token !== t.refresh_token, JSON.stringify(next));
      const read = await rpc("tools/call", { name: "search_notes", arguments: { query: CANARY } }, next.access_token);
      assert(read.structuredContent.results.length > 0);
    }
    // An old setup with the token in the address: refused, and logged without it.
    const inPath = await serve(`/pane_${randomHex(32)}`, { method: "POST", body: "{}" });
    assertEquals(inPath.status, 401);
    await inPath.body?.cancel();
    unstub();

    // MARK: Every row of every table

    const tables = (await pg.query<{ s: string; t: string }>(
      `select table_schema as s, table_name as t from information_schema.tables
       where table_schema in ('public', 'auth', 'storage') and table_type = 'BASE TABLE' order by 1, 2`)).rows;
    assert(tables.length > 20);
    const copies = new Set(["note_share_pages", "note_share_files"]);
    const canaryHex = toHex(enc.encode(CANARY));
    const encoded = base64Forms(CANARY);
    // Three alignments; the URL-safe form differs only when the base64 holds + or /.
    assert(encoded.length >= 3 && encoded.every((f) => f.length >= 40), JSON.stringify(encoded));
    // The forms are what base64 of a longer value holds: found inside one at every alignment.
    for (const k of [0, 1, 2]) {
      const b64 = toBase64(new Uint8Array([...crypto.getRandomValues(new Uint8Array(k)), ...enc.encode(CANARY), 7, 7]));
      assert(encoded.some((f) => b64.includes(f)), `offset ${k}`);
    }
    const holds = (text: string) =>
      text.includes(CANARY) || text.toLowerCase().includes(canaryHex) || encoded.some((f) => text.includes(f));
    let rows = 0;
    for (const { s, t } of tables) {
      if (s === "public" && copies.has(t)) continue;
      // A shared page's public copy is the one readable place, on purpose.
      const text = s === "public" && t === "note_shares"
        ? `select (to_jsonb(x) - 'title' - 'body')::text as row from public.note_shares x`
        : `select x::text as row from "${s}"."${t}" x`;
      for (const { row } of (await pg.query<{ row: string }>(text)).rows) {
        rows++;
        assert(!holds(row), `${s}.${t} holds the canary: ${row.slice(0, 300)}`);
      }
    }
    assert(rows > 30, `only ${rows} rows`);
    // The search finds it where it is readable: the copy of the note shared on purpose.
    const [copy] = (await pg.query<{ title: string; body: string }>(`select title, body from public.note_shares where slug = $1`, [shareLink.slug])).rows;
    assertEquals(copy.title, `Shared ${CANARY}`);
    // The AI's edit isn't published by the server: the owner's device does that on its next sync.
    assertEquals(copy.body, sharedBody);

    // A locked note's head is its title and nothing else.
    const [{ head_ct }] = (await pg.query<{ head_ct: string }>(`select head_ct from public.notes where id = $1`, [locked])).rows;
    assertEquals(await a.vault.openHead(locked, head_ct), { title: `Locked ${CANARY}` });
  } finally {
    for (const m of methods) console[m] = real[m];
    globalThis.fetch = realFetch;
  }

  // MARK: Everything logged

  assert(logged.length > 0, "the refused address is logged, so the capture works");
  const encoded = base64Forms(CANARY);
  for (const line of logged) {
    assert(!line.includes(CANARY) && !encoded.some((f) => line.includes(f)), `logged: ${line}`);
    assert(!/pane_|amb_/.test(line), `a token was logged: ${line}`);
    const fields = JSON.parse(line);
    assert(Object.keys(fields).every((k) => ["event", "tool", "status", "ms", "code", "kind", "count", "path_kind", "method"].includes(k)), line);
  }
});
