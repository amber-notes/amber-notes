// Export My Data: everything the server keeps about one account, as a zip (GDPR access and
// portability). The caller has already been identified from its access token; `uid` is theirs.
//
//   data.json    every table row that belongs to the account, plus its sign-in records
//   README.txt   what's in the zip
//
// Notes are end-to-end encrypted: the server can't read them, so the notes themselves are exported
// by the app on the device (Settings › Privacy & Security). data.json lists them by id, folder and
// date, without their encrypted text, which nobody but the account's devices can open.
import { strToU8, zipSync } from "npm:fflate@0.8.2";
import type { Sql } from "npm:postgres@3.4.5";

export type Export = { name: string; files: Record<string, string> };

const README = `Your Amber Notes data

data.json holds everything our server keeps about your account that isn't encrypted: your
profile, the list of your notes, folders, earlier versions and files (ids and dates only), AI
connections, share links, locked-note settings, the usage counts the app keeps, and your
current sign-ins.

Your notes, folder names, file names and files are end-to-end encrypted with a key only your
devices have, so we can't read them and can't export them. To take your notes with you, open
Amber Notes and choose Settings > Privacy & Security > Export your notes.

Access tokens and passwords are never stored in readable form, so they aren't included.

Questions: emil@norditech.se
`;

type Row = Record<string, unknown>;

/** Collects the account's data. Reads only rows with the account's id. */
export async function collect(sql: Sql, uid: string, now = new Date()): Promise<Export> {
  const [account] = await sql<Row[]>`
    select id, email, created_at, last_sign_in_at, raw_app_meta_data -> 'providers' as sign_in_methods
    from auth.users where id = ${uid}`;
  const [profile] = await sql<Row[]>`select display_name, avatar_path, updated_at from public.profiles where user_id = ${uid}`;
  const folders = await sql<Row[]>`
    select id, parent_id, sort_index, created_at, updated_at from public.folders
    where user_id = ${uid} and deleted_at is null order by created_at`;
  const notes = await sql<Row[]>`
    select id, folder_id, parent_id, is_pinned, created_at, updated_at, trashed_at,
           locked_body is not null as locked, body_source, body_client, body_at, ai_editor, ai_edited_at
    from public.notes where user_id = ${uid} and deleted_at is null order by created_at`;
  const versions = await sql<Row[]>`
    select r.note_id, r.version, r.source, r.client, r.created_at
    from public.note_revisions r join public.notes n on n.id = r.note_id
    where r.user_id = ${uid} and n.deleted_at is null order by r.note_id, r.version`;
  const files = await sql<Row[]>`
    select id, size, created_at from public.attachments
    where user_id = ${uid} and deleted_at is null order by created_at`;
  const connections = await sql<Row[]>`
    select name, kind, can_write, client_id, redirect_host, created_at, last_used_at, revoked_at
    from public.mcp_tokens where user_id = ${uid} order by created_at`;
  const shares = await sql<Row[]>`
    select slug, note_id, include_subnotes, created_at, revoked_at, title, body, published_at from public.note_shares where user_id = ${uid} order by created_at`;
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
  return { name: `amber-notes-export-${now.toISOString().slice(0, 10)}.zip`, files: out };
}

/** The export as zip bytes. */
export function zip(e: Export): Uint8Array<ArrayBuffer> {
  return new Uint8Array(zipSync(Object.fromEntries(Object.entries(e.files).map(([p, s]) => [p, strToU8(s)])), { level: 6 }));
}
