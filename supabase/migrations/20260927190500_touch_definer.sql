-- The touch trigger records revisions, which clients cannot insert directly.
alter function public.pane_touch() security definer;
alter function public.pane_trim_revisions() security definer;
