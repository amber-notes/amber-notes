-- Amber Notes is now Pinto Notes. The errors the database raises still said the old name, and the
-- apps and the MCP server show those words as they are:
--
-- create_account_key    "Your notes were reset on another device. Open Pinto Notes again."
-- pane_note_lock        "Update Pinto Notes to keep syncing…", "This note is locked. Open it in
--                       Pinto Notes to change it.", "…your current notes password in Pinto Notes."
-- pane_note_page_touch,
-- pane_sealed_guard     "This device has an old key for your notes. Open Pinto Notes again…"
-- pane_storage_check    "Pinto Notes is full: you use all 2 GB…"
-- share_note            "Update Pinto Notes to share this note."
--
-- Only the name changes. Each function is read back as the database holds it now and replaced with
-- the same definition, so its arguments, owner, grants, security definer and search_path stay, and
-- so does whatever a later migration made of it. Error codes and hints, which the apps and the
-- server decide by, are untouched. Running it twice changes nothing.
do $$
declare f record;
begin
  for f in
    select p.oid, pg_get_functiondef(p.oid) as def
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prosrc like '%Amber Notes%'
  loop
    execute replace(f.def, 'Amber Notes', 'Pinto Notes');
  end loop;
end $$;
