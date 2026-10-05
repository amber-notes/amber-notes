-- Note apps as projects of files (prototype; see Pane/Views/NotePageProject.swift): a version holds
-- the whole project, sealed (at most 3 MB before sealing on the device, about 4.1 MB as a sealed
-- box). The 700 kB cap on a page's sealed text becomes 4.5 MB, for the page and its versions.
alter table public.note_pages drop constraint if exists note_pages_page_ct_check;
alter table public.note_pages add constraint note_pages_page_ct_check
  check (page_ct is null or (page_ct ~ '^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$' and octet_length(page_ct) <= 4500000));

alter table public.note_page_versions drop constraint if exists note_page_versions_page_ct_check;
alter table public.note_page_versions add constraint note_page_versions_page_ct_check
  check (page_ct ~ '^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$' and octet_length(page_ct) <= 4500000);
