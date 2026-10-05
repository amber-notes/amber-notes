// Collaboration prototype: a local stand-in for Supabase (PostgREST + Realtime) so two simulators
// can share a note without Docker. The database is the real schema, every migration including
// 20261005120000_collaboration.sql, in an in-process Postgres (PGlite), and every query runs as the
// caller with row-level security, as PostgREST would. What it adds is a WebSocket per note that
// relays new sealed updates and sealed presence, like a Realtime private channel.
//
// It never sees a key: everything it stores or relays is sealed by the apps.
//
//   deno run -A scripts/collab-relay.ts [port]        (default 56480; local only)
//
// Prototype shortcuts: the caller is named by `Authorization: Bearer proto.<user id>` instead of a
// signed JWT, and /dev/user makes accounts. Never run this anywhere but your own machine.
import { asUser, schemaDB } from "../supabase/functions/mcp/pglite.ts";

const port = Number(Deno.args[0] ?? 56480);
const pg = await schemaDB();
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 23), ...a);

type Peer = { ws: WebSocket; user: string; presence?: string };
const rooms = new Map<string, Set<Peer>>();

// Bigints (update ids) go out as numbers; they stay far below 2^53 here.
const stringify = (v: unknown) => JSON.stringify(v, (_, x) => typeof x === "bigint" ? Number(x) : x);
const json = (body: unknown, status = 200) => new Response(stringify(body), { status, headers: { "content-type": "application/json" } });

function caller(req: Request): string | null {
  const m = /^Bearer proto\.([0-9a-f-]{36})$/i.exec(req.headers.get("authorization") ?? "");
  return m ? m[1].toLowerCase() : null;
}

function broadcast(note: string, message: unknown, except?: Peer) {
  const text = stringify(message);
  for (const p of rooms.get(note) ?? []) if (p !== except && p.ws.readyState === WebSocket.OPEN) p.ws.send(text);
}

// The functions the apps may call, with their argument count.
const rpcs: Record<string, number> = {
  create_account_key: 4, collab_publish_identity: 2, collab_find_person: 1, collab_members: 1, collab_share: 4,
  collab_invite: 5, collab_accept: 2, collab_remove: 4, collab_open_link: 2, collab_join_link: 4, collab_create_link: 6,
  publish_sealed_link: 3, stop_sealed_link: 1, publish_template: 4, stop_template: 1, collab_stop_link: 1,
};

/** As a visitor with no account (the anon role), like the site calling a public RPC. */
async function asAnon<T>(sql: string, params: unknown[]): Promise<T[]> {
  return await pg.transaction(async (tx) => {
    await tx.exec(`set local role anon`);
    return (await tx.query<T>(sql, params)).rows;
  });
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === "/dev/user" && req.method === "POST") {
    const { email, name } = await req.json();
    const have = await pg.query<{ id: string }>(`select id from auth.users where lower(email) = lower($1)`, [email]);
    const id = have.rows[0]?.id ?? crypto.randomUUID();
    if (!have.rows[0]) {
      await pg.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
      await asUser(pg, id, `insert into public.profiles (display_name) values ($1)`, [name]);
    }
    log("user", name, id);
    return json({ id });
  }

  // What the site reads for /s/<id> and /t/<id>: public, no account.
  const pub = /^\/public\/(sealed-link|template)\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
  if (pub) {
    const rows = pub[1] === "sealed-link"
      ? await asAnon(`select * from public.sealed_link($1)`, [pub[2]])
      : await asAnon(`select * from public.shared_template($1)`, [pub[2]]);
    return rows[0] ? json(rows[0]) : json(null, 404);
  }

  const me = caller(req);
  if (!me) return json({ message: "Not signed in" }, 401);

  if (url.pathname === "/ws") {
    const note = url.searchParams.get("note") ?? "";
    const [r] = await asUser<{ role: string | null }>(pg, me, `select public.collab_role($1) as role`, [note]);
    if (!r?.role) return json({ message: "Not a member" }, 403);
    const { socket, response } = Deno.upgradeWebSocket(req);
    const peer: Peer = { ws: socket, user: me };
    socket.onopen = () => {
      if (!rooms.has(note)) rooms.set(note, new Set());
      rooms.get(note)!.add(peer);
      for (const p of rooms.get(note)!) if (p !== peer && p.presence) socket.send(stringify({ type: "presence", user: p.user, ct: p.presence }));
      log("join", note.slice(0, 8), me.slice(0, 8), rooms.get(note)!.size);
    };
    socket.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.type === "presence" && typeof m.ct === "string" && m.ct.length < 4000) {
        peer.presence = m.ct;
        broadcast(note, { type: "presence", user: me, ct: m.ct }, peer);
      }
    };
    socket.onclose = () => {
      rooms.get(note)?.delete(peer);
      broadcast(note, { type: "leave", user: me });
      log("leave", note.slice(0, 8), me.slice(0, 8));
    };
    return response;
  }

  try {
    const body = req.method === "POST" ? await req.json() : {};
    if (url.pathname.startsWith("/rpc/")) {
      const fn = url.pathname.slice(5);
      const n = rpcs[fn];
      if (n === undefined) return json({ message: "Unknown function" }, 404);
      const args: unknown[] = body.args ?? [];
      if (args.length !== n) return json({ message: "Wrong arguments" }, 400);
      const rows = await asUser(pg, me, `select * from public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")})`, args);
      return json(rows);
    }
    if (url.pathname === "/updates" && req.method === "POST") {
      const [row] = await asUser(pg, me, `insert into public.note_updates (note_id, epoch, ct) values ($1, $2, $3) returning *`,
        [body.note_id, body.epoch, body.ct]);
      broadcast(body.note_id, { type: "update", row });
      return json(row);
    }
    if (url.pathname === "/updates") {
      const note = url.searchParams.get("note"), after = Number(url.searchParams.get("after") ?? 0);
      // A device starting out (after 0) or one behind the newest snapshot gets the snapshot first.
      const [snapshot] = await asUser<{ upto: number }>(pg, me, `select * from public.note_snapshots where note_id = $1 order by upto desc, epoch desc limit 1`, [note]);
      const upto = Number(snapshot?.upto ?? 0);
      const useSnapshot = snapshot !== undefined && (after === 0 || after < upto);
      const rows = await asUser(pg, me, `select * from public.note_updates where note_id = $1 and id > $2 order by id`, [note, useSnapshot ? upto : after]);
      return json({ snapshot: useSnapshot ? snapshot : null, updates: rows });
    }
    if (url.pathname === "/snapshots" && req.method === "POST") {
      const [row] = await asUser(pg, me, `insert into public.note_snapshots (note_id, upto, epoch, ct) values ($1, $2, $3, $4) returning note_id, upto, epoch`,
        [body.note_id, body.upto, body.epoch, body.ct]);
      return json(row);
    }
    if (url.pathname === "/memberships") {
      // Your own rows (with your wraps) and each note's sealed head.
      const rows = await asUser(pg, me, `select m.*, s.head_ct, s.epoch as note_epoch, s.owner_id from public.note_members m
        join public.shared_notes s on s.id = m.note_id where m.user_id = auth.uid() order by m.invited_at`);
      return json(rows);
    }
    if (url.pathname === "/identity") {
      return json(await asUser(pg, me, `select * from public.identity_keys where user_id = auth.uid()`));
    }
    if (url.pathname === "/head" && req.method === "POST") {
      await asUser(pg, me, `update public.shared_notes set head_ct = $2 where id = $1`, [body.note_id, body.head_ct]);
      return json({});
    }
    return json({ message: "Not found" }, 404);
  } catch (e) {
    log("refused", url.pathname, (e as Error).message);
    return json({ message: (e as Error).message }, 400);
  }
}

// The user-content origin: one other port, serving only the note-page frame, with a CSP that allows
// no network at all. In the product this is its own domain (ambernotes-usercontent.app).
const frame = await Deno.readTextFile(new URL("../usercontent/frame.html", import.meta.url));
const frameCSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; " +
  "connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors http://localhost:* http://127.0.0.1:*";
Deno.serve({ port: port + 1, hostname: "127.0.0.1", onListen: () => {} }, (req) => {
  if (new URL(req.url).pathname !== "/frame.html") return new Response("Not found", { status: 404 });
  return new Response(frame, { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": frameCSP,
    "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cache-control": "no-store" } });
});

log(`collab relay on http://127.0.0.1:${port}, user content on http://127.0.0.1:${port + 1}`);
Deno.serve({ port, hostname: "127.0.0.1", onListen: () => {} }, async (req) => {
  const upgrade = req.headers.get("upgrade");
  const path = new URL(req.url).pathname;
  const res = await handle(req);
  if (!upgrade && path !== "/memberships") log(req.method, path, res.status);
  return res;
});
