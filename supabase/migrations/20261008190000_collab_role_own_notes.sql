-- collab_role(note, user) answered for anyone: a signed-in person could ask whether any user is a member of
-- any note (docs/Technical/security-definer-review.md). It stays callable by authenticated, because the
-- policies that use it run as the caller, but it now answers only about a note the caller is in (about
-- themselves, or a fellow member, as collab_members already shows), and to the server's own roles.
create or replace function public.collab_role(p_note uuid, p_user uuid default auth.uid()) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.note_members m
  where m.note_id = p_note and m.user_id = p_user
    and (auth.uid() is null
         or p_user = auth.uid()
         or exists (select 1 from public.note_members me where me.note_id = p_note and me.user_id = auth.uid()))
$$;
