-- Devices subscribe to their own changes (RLS applies to realtime).
alter publication supabase_realtime add table public.notes, public.folders;
