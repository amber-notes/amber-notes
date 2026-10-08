# SECURITY DEFINER functions: who can call them

The Supabase security advisor on staging (dev's schema) warns 113 times that a `SECURITY DEFINER`
function in `public` can be executed by `anon` (30) or `authenticated` (83). This goes through all of
them: which callers each one really has, which grants it needs, and a migration plan for the rest.
Nothing here has been applied, on staging or in production.

How it was checked (2026-10-08): the grants come from `has_function_privilege` on staging, read-only.
Callers come from `git grep` over `Pane`, `PaneShare`, `web`, `supabase/functions`, `cli` and
`scripts` on dev (tests set aside), and from the policies in `supabase/migrations`. Both trigger
functions were also called over the API with the anon key: PostgREST answers `PGRST202`.

## The 113, sorted

| Group | Functions | Warnings | Needs the grant? |
|---|---|---|---|
| Trigger functions | 24 | 48 (anon and authenticated each) | No |
| Called by the app, checks `auth.uid()` | 43 | 43 (authenticated) | Yes, authenticated |
| Collaboration, guarded by the caller's own role | 4 | 4 (authenticated) | Yes, authenticated |
| Used inside storage policies | 3 | 3 (authenticated) | Yes, authenticated |
| Called by the MCP function as `authenticated` | 3 | 3 (authenticated) | Yes, authenticated |
| Public pages and the site | 6 | 11 (6 anon, 5 authenticated) | Anon for 4 of them; see below |
| No caller: `collab_role(p_note, p_user)` | 1 | 1 (authenticated) | No, and it says too much |

### Trigger functions (24): no exposure, revoke for hygiene

`collab_compact`, `collab_update_guard`, `mcp_token_stay_revoked`, `pane_account_attachment`,
`pane_account_folder`, `pane_account_note`, `pane_account_share`, `pane_account_token`,
`pane_attachment_folder`, `pane_attachment_forget_copies`, `pane_attachment_gone`,
`pane_count_ai_edit`, `pane_folder_trash_files`, `pane_note_forget_copies`, `pane_note_lock`,
`pane_note_page_drop`, `pane_note_page_keep`, `pane_note_page_touch`, `pane_profile_touch`,
`pane_sealed_guard`, `pane_share_forget_copy`, `pane_storage_guard`, `pane_touch`, `pane_trim_revisions`.

They return `trigger`, so PostgREST doesn't list them as RPCs, and Postgres won't run them except as a
trigger. The grant only exists because `create function` gives `EXECUTE` to `public` by default.
Firing a trigger doesn't check the caller's `EXECUTE` (only `create trigger` does), so revoking it
changes nothing that runs. These 48 warnings are the bulk of the count.

### Called by the app, checking `auth.uid()` (43): keep

`account_key_state`, `change_notes_password`, `collab_accept`, `collab_find_person`, `collab_invite`,
`collab_join_link`, `collab_publish_identity`, `collab_remove`, `collab_share`, `create_account_key`,
`create_mcp_token`, `device_add_answer`, `device_add_done`, `device_add_find`, `device_add_pickup`,
`device_add_request`, `forget_key_device`, `key_device_check_in`, `mark_recovery_key_saved`,
`pane_active_days_add`, `pane_feature_used`, `pane_features_used`, `pane_heard_from_answer`,
`pane_heard_from_state`, `pane_seen_device`, `pane_setup_mark`, `pane_setup_state`,
`pane_share_ask_decide`, `pane_share_ask_state`, `pane_tip_event`, `publish_sealed_link`,
`publish_share`, `publish_share_file`, `publish_template`, `register_device_token`,
`remove_key_device`, `share_note`, `share_slug`, `start_fresh`, `stop_sealed_link`, `stop_template`,
`storage_usage`, `unshare_note`.

These are the signed-in API: each acts on the caller's own rows through `auth.uid()`. They need
`authenticated`. None needs `anon`, and none has it.

### Collaboration, guarded by the caller's role (4): keep

`collab_create_link`, `collab_members`, `collab_open_link` and `collab_stop_link` don't read
`auth.uid()` themselves, but each checks `public.collab_role(p_note)` (the one-argument form, which
does) or the link's answer hash before doing anything. The app calls all four. They need
`authenticated`. They are on dev only; collaboration is a prototype behind `-collab`.

### Inside storage policies (3): keep

`pane_files_ok`, `pane_storage_ok` and `pane_avatars_ok` are called from the `storage.objects` insert
policies. Policies run as the caller, so `authenticated` needs `EXECUTE`. They read only the caller's
own usage.

### Called by the MCP function as `authenticated` (3): keep, one to watch

- `pane_scan_budget` and `storage_room` are called inside the MCP function's transactions, after
  `set_config('role', 'authenticated')` (`supabase/functions/mcp/tools.ts`, `mcp/folder_files.ts`),
  so they need the grant.
- `pane_take` is called before the role is set, as the connection's own role, so it doesn't need
  `authenticated` today. Revoking it from `authenticated` is fine, but the triggers call it from
  inside definer functions, which run as the owner, so nothing else changes.
- What a signed-in person can do with these directly: spend their own rate bucket or scan budget, or
  ask how much room they have left. Nobody else's.

### Public pages and the site (6)

| Function | Caller | Anon needed? |
|---|---|---|
| `shared_note(p_slug, p_sub)` | Shared pages on the site, and the app | Yes. It reads only shares that are published, by their unguessable slug |
| `report_share(...)` | The site's "Report this page" | Yes. It checks its input and rate-limits per reporter and per page |
| `count_download(p_product)` | `web/lib/downloads.ts`, with the anon key | Yes, as the site calls it now. It takes any `p_product` string, so anyone can add rows of junk products. Either check the product against a list in the function, or give the site a server-only key and revoke anon |
| `forget_device_token(p_token)` | The app, on the launch after a sign-out that couldn't reach the server | Yes, because by then there's no session. Anyone holding a device's push token can delete its row; tokens are 64+ hex characters and not public. Acceptable; a sign-out could also delete the row while it still has the session, and this stays as the fallback |
| `sealed_link(p_id)` | No caller yet. The site reads the local relay; the RPC is for the product version of collaboration | Not yet. Revoke `anon` until the site calls it |
| `shared_template(p_id)` | No caller yet, same as `sealed_link` | Not yet. Revoke until it ships |

For all six, `authenticated` also has the grant. Signed-in people read the same public pages, so it
does no harm, and revoking it would break the site for a visitor who is signed in.

### `collab_role(p_note uuid, p_user uuid)`: revoke

The two-argument form returns any user's role on any note. Called directly by a signed-in person,
it says whether user X is a member of note Y. It needs both ids, so this is a small leak, but a leak.
Nothing calls it over the API: other definer functions call it, and they run as the owner. Revoke
it from `authenticated` (and from `public`). It is on dev only, so it can be fixed before it reaches
production.

## Migration plan

One additive migration, with a timestamp newer than every migration on dev at the time it's written.
It only revokes, so older apps keep working. Each revoke goes on the
exact signature, and nothing is dropped.

```sql
-- Trigger functions: nothing calls them over the API; the grant was only the default.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- Asks for any user's role on any note: only for other definer functions.
revoke execute on function public.collab_role(uuid, uuid) from public, anon, authenticated;

-- The rate bucket is taken by the functions as their own role and by triggers.
revoke execute on function public.pane_take(text, double precision) from public, anon, authenticated;

-- Public reads that nothing calls yet: granted again when the site uses them.
revoke execute on function public.sealed_link(text) from anon;
revoke execute on function public.shared_template(text) from anon;
```

Later functions should not get `EXECUTE` by default: `alter default privileges in schema public
revoke execute on functions from public;`. Each migration then grants what its function needs, as
most of them already do.

Before it ships:

1. Run the pglite tests (`deno test -A supabase/functions`) and the release gate's security section
   (`scripts/release-gate.sh <ref> --only security`). The row-level security and plaintext checks
   cover the app's own calls.
2. Apply on staging, then run the gate's perf section on fleet-air: sign-in, sync, sharing and the
   AI connection all go through these functions.
3. Expected advisor result: the 48 trigger warnings, the `collab_role` and `pane_take` warnings, and
   the `sealed_link` and `shared_template` anon warnings go (53). About 60 remain, every one a
   function that the app, the site or a policy calls on purpose.

Order with production: the revokes touch functions in both main and dev, except `collab_role`,
`sealed_link`, `shared_template` and the collaboration triggers, which exist only on dev. The
dev-only lines apply with dev's migrations; the rest can go to production on their own.

Still open, for whoever owns them:

- `count_download`: a product list in the function, or a server-only key.
- `forget_device_token`: delete the row at sign-out while the session still exists.
