// Delete Account waits 72 hours after the password changed or an emailed link signed in, like
// Start fresh (supabase/migrations/20261002200000_start_fresh_after_reset.sql). Someone who can read
// the account's email must not be able to reset the password and delete the notes.
import type { Sql } from "npm:postgres@3.4.5";

export const DELETE_PAUSED = "Deleting your account is paused for 72 hours after a password reset, to protect your notes.";

/// Until when deleting is paused, in UTC (`2026-10-05T14:30:00.000Z`), or null.
export async function deletePausedUntil(sql: Sql, uid: string): Promise<string | null> {
  const [row] = await sql<{ until: Date | null }[]>`select public.pane_reset_pause_until(${uid}::uuid) as until`;
  return row?.until ? new Date(row.until).toISOString() : null;
}
