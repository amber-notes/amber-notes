// What Delete Account removes from the database, once the account's storage files are gone.
// Every public table cascades from auth.users; these don't, so they go too:
//   * reports about the account's share pages (they're linked by the page's link, not the account);
//   * the email on the sign-up allowlist;
//   * the auth server's audit log rows, which name the account, its email and network address.
import type { Sql } from "npm:postgres@3.4.5";
import { logError } from "../_shared/log.ts";

export async function forget(sql: Sql, uid: string): Promise<void> {
  await sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    await t`delete from public.share_reports r using public.note_shares s where s.slug = r.slug and s.user_id = ${uid}`;
    await t`delete from public.signup_allowlist a using auth.users u where u.id = ${uid} and a.email = lower(u.email)`;
    // Straight in the database: it doesn't depend on which key format the auth admin API accepts.
    // Identities, sessions and every public table cascade from auth.users.
    await t`delete from auth.users where id = ${uid}`;
  });
  // Separate, so a table the auth server owns can never stop an account from being deleted. What's
  // left here is trimmed after 30 days anyway (pane_forget_daily).
  try {
    const [t] = await sql<{ ok: boolean }[]>`select to_regclass('auth.audit_log_entries') is not null as ok`;
    if (t.ok) await sql`delete from auth.audit_log_entries where payload ->> 'actor_id' = ${uid}::text`;
  } catch (e) {
    logError("account delete: audit log", e);
  }
}
