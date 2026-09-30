// Export My Data: everything the server keeps about one account, as a zip (GDPR access and
// portability). The caller has already been identified from its access token; `uid` is theirs.
//
//   data.json              every table row that belongs to the account, plus its sign-in records
//   notes/<folder>/*.md    each note as Markdown, in its folder; Recently Deleted in its own folder
//   README.txt             what's in the zip
//
// Files themselves aren't copied into the zip, only their list; they stay in the app. Locked notes
// are exported as they're stored: their encrypted text, which only the notes password opens.
import { strToU8, zipSync } from "npm:fflate@0.8.2";
import type { Sql } from "npm:postgres@3.4.5";

export type Export = { name: string; files: Record<string, string> };

const README = `Your Amber Notes data

data.json holds everything our server keeps about your account: your profile, folders,
notes, earlier versions of notes, the list of your files, AI connections, share links,
locked-note settings, the usage counts the app keeps, and your current sign-ins.

The notes folder has each note as a Markdown file, in its folder. Notes in Recently Deleted
are in their own folder.

Files you added to notes aren't copied here. Open the note in Amber Notes to save them.

Locked notes are exported encrypted, the way we store them. Unlock a note in Amber Notes to
read or copy its text.

Access tokens and passwords are never stored in readable form, so they aren't included.

Questions: emil@norditech.se
`;

/** A file name that works on every system, without a path. */
export function safeName(title: string): string {
  const name = title.replace(/[\/\\:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  return (name || "Untitled").slice(0, 80);
}

type Row = Record<string, unknown>;
type Folder = { id: string; name: string; parent_id: string | null };

/** Folder path from the top, e.g. "Work/Clients"; a loop or a missing parent ends it. */
function folderPath(id: string | null, byId: Map<string, Folder>): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (let f = id ? byId.get(id) : undefined; f && !seen.has(f.id); f = f.parent_id ? byId.get(f.parent_id) : undefined) {
    seen.add(f.id);
    parts.unshift(safeName(f.name));
  }
  return parts.join("/");
}

/** Collects the account's data. Reads only rows with the account's id. */
export async function collect(sql: Sql, uid: string, now = new Date()): Promise<Export> {
  const [account] = await sql<Row[]>`
    select id, email, created_at, last_sign_in_at, raw_app_meta_data -> 'providers' as sign_in_methods
    from auth.users where id = ${uid}`;
  const [profile] = await sql<Row[]>`select display_name, avatar_path, updated_at from public.profiles where user_id = ${uid}`;
  const folders = await sql<Row[]>`
    select id, name, parent_id, sort_index, created_at, updated_at from public.folders
    where user_id = ${uid} and deleted_at is null order by created_at`;
  const notes = await sql<Row[]>`
    select id, title, body, folder_id, parent_id, is_pinned, created_at, updated_at, trashed_at,
           locked_body is not null as locked, locked_body, body_source, body_client, body_at, ai_editor, ai_edited_at
    from public.notes where user_id = ${uid} and deleted_at is null order by created_at`;
  const versions = await sql<Row[]>`
    select r.note_id, r.version, r.body, r.locked_body, r.source, r.client, r.created_at
    from public.note_revisions r join public.notes n on n.id = r.note_id
    where r.user_id = ${uid} and n.deleted_at is null order by r.note_id, r.version`;
  const files = await sql<Row[]>`
    select id, filename, content_type, size, created_at from public.attachments
    where user_id = ${uid} and deleted_at is null order by created_at`;
  const connections = await sql<Row[]>`
    select name, kind, can_write, client_id, redirect_host, created_at, last_used_at, revoked_at
    from public.mcp_tokens where user_id = ${uid} order by created_at`;
  const shares = await sql<Row[]>`
    select slug, note_id, include_subnotes, created_at, revoked_at from public.note_shares where user_id = ${uid} order by created_at`;
  const [lock] = await sql<Row[]>`
    select salt, iterations, key_id, verifier, hint, previous, created_at, updated_at from public.note_locks where user_id = ${uid}`;
  const [setup] = await sql<Row[]>`select imported_at, dismissed_at, celebrated_at, updated_at from public.pane_setup where user_id = ${uid}`;
  const [totals] = await sql<Row[]>`select notes, notes_bytes, folders from public.pane_usage where user_id = ${uid}`;
  const ai_edits = await sql<Row[]>`select day, kind, n from public.pane_activity where user_id = ${uid} order by day`;
  const tips = await sql<Row[]>`select day, tip, event, n from public.pane_tip_activity where user_id = ${uid} order by day`;
  const days = await sql<Row[]>`select day from public.pane_active_days where user_id = ${uid} order by day`;
  const devices = await sql<Row[]>`select device_id, platform, first_seen, last_seen from public.pane_devices where user_id = ${uid}`;
  const [share_ask] = await sql<Row[]>`select choice, decided_at from public.pane_share_ask where user_id = ${uid}`;
  const features = await sql<Row[]>`select feature, first_at from public.pane_feature_use where user_id = ${uid}`;
  const sessions = await sql<Row[]>`
    select created_at, refreshed_at, user_agent, host(ip) as ip from auth.sessions where user_id = ${uid} order by created_at`;

  const data = {
    exported_at: now.toISOString(),
    format: 1,
    account: account ?? null,
    profile: profile ?? null,
    folders,
    notes,
    versions,
    files,
    ai_connections: connections,
    share_links: shares,
    locked_notes: lock ?? null,
    usage: { totals: totals ?? null, setup: setup ?? null, ai_edits_per_day: ai_edits, tips, active_days: days.map((d) => d.day), devices, share_ask: share_ask ?? null, features_used: features },
    sign_ins: sessions,
  };

  const out: Record<string, string> = { "README.txt": README, "data.json": JSON.stringify(data, null, 2) };
  const byId = new Map((folders as unknown as Folder[]).map((f) => [f.id, f]));
  for (const n of notes) {
    const dir = n.trashed_at ? "Recently Deleted" : folderPath(n.folder_id as string | null, byId);
    const base = `notes/${dir ? `${dir}/` : ""}${safeName(String(n.title ?? ""))}`;
    let path = `${base}.md`;
    for (let i = 2; path in out; i++) path = `${base} ${i}.md`;
    out[path] = n.locked
      ? `# ${n.title ?? "Locked note"}\n\nThis note is locked. Its encrypted text is in data.json. Unlock it in Amber Notes to read it.\n`
      : String(n.body ?? "");
  }
  return { name: `amber-notes-export-${now.toISOString().slice(0, 10)}.zip`, files: out };
}

/** The export as zip bytes. */
export function zip(e: Export): Uint8Array<ArrayBuffer> {
  return new Uint8Array(zipSync(Object.fromEntries(Object.entries(e.files).map(([p, s]) => [p, strToU8(s)])), { level: 6 }));
}
