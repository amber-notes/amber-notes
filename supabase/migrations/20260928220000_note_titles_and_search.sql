-- Titles follow the app's rules (NoteText.title in the app): the first line that still has
-- text once markdown is stripped. Before this, a note starting with "- [ ] Milk" was titled
-- "- [ ] Milk", "<u>Plan</u>" kept its tags, and "snake_case" lost its underscores, so AI
-- tools looked notes up by titles that didn't match what the app showed.

create or replace function public.note_title(body text) returns text
language plpgsql immutable parallel safe set search_path = '' as $$
declare
  line text;
  s text;
begin
  foreach line in array string_to_array(coalesce(body, ''), E'\n') loop
    s := btrim(regexp_replace(line, '</?[a-zA-Z][^>]*>', '', 'g'), E' \t\r');
    -- One block prefix: heading, quote, checklist item, bullet, then a number.
    s := regexp_replace(s, '^(#{1,6} |> |- \[[ xX]\] |[-*+] )', '');
    s := regexp_replace(s, '^[0-9]+[.)] ', '');
    if s like '```%' or s ~ '^[-*_|:= ]*$' then
      continue;
    end if;
    s := regexp_replace(s, '\[([^]]*)\]\([^)]*\)', '\1', 'g');
    s := replace(replace(replace(replace(s, '**', ''), '__', ''), '~~', ''), '`', '');
    -- *emphasis* and _emphasis_, but not the underscores inside snake_case.
    s := regexp_replace(s, '(?<![[:alnum:]_*])[*_](?=[^[:space:]])(.+?)(?<=[^[:space:]])[*_](?![[:alnum:]_*])', '\1', 'g');
    if left(s, 1) = '|' then
      s := array_to_string(array(
        select btrim(c) from unnest(string_to_array(s, '|')) as c where btrim(c) <> ''), '  ');
    end if;
    s := btrim(s, E' \t');
    if s <> '' then
      return left(s, 300);
    end if;
  end loop;
  return 'New Note';
end $$;

alter table public.notes drop column title;
alter table public.notes add column title text generated always as (public.note_title(body)) stored;
create index notes_title on public.notes (user_id, lower(title)) where deleted_at is null;

-- Search: a query's % and _ are text, not wildcards (searching "%" used to match every note).
-- Ranking uses the full-text rank plus how well the title matches; snippets are built for
-- the returned rows only (building them for every match was most of the time on big notes).
create or replace function public.search_notes(q text, max_results int default 20)
returns table (id uuid, title text, folder_id uuid, updated_at timestamptz, snippet text, rank real)
language sql stable security invoker set search_path = '' as $$
  with p as (
    select websearch_to_tsquery('simple', q) as tsq,
           '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  ),
  hits as (
    select n.id, n.title, n.folder_id, n.updated_at, n.body,
           (ts_rank(n.search, p.tsq) * 2
             + extensions.word_similarity(q, n.title)
             + case when n.title ilike p.pattern then 1 else 0 end)::real as rank
    from public.notes n, p
    where n.deleted_at is null and n.trashed_at is null
      and (n.search @@ p.tsq or n.body ilike p.pattern)
    order by rank desc, n.updated_at desc
    limit least(greatest(max_results, 1), 100)
  )
  select h.id, h.title, h.folder_id, h.updated_at,
         ts_headline('simple', h.body, p.tsq,
           'MaxWords=24, MinWords=8, StartSel=«, StopSel=», MaxFragments=2') as snippet,
         h.rank
  from hits h, p
  order by h.rank desc, h.updated_at desc
$$;
