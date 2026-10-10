-- Note pages (prototype): whether an AI's preview_app may show a note's app with the person's real
-- data. Off by default: previews and check_app render a sample with the same shape and none of the
-- content. Only the person changes it, in the app's settings; no MCP tool writes it.
alter table public.profiles add column app_previews_real boolean not null default false;
