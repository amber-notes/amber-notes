-- A connection request belongs to the first Amber Notes account that opens it (in the app or on
-- the web consent page, ambernotes.app/connect). Another account can't see or answer it.
-- Additive: the MCP function that reads this column deploys after this migration.
alter table public.oauth_requests add column if not exists claimed_by uuid references auth.users (id) on delete cascade;
