-- "How did you hear about Amber Notes?" gains GitHub, next to Product Hunt or Hacker News.
-- Only the list of sources changes; the answers already given stay as they are.

alter table public.pane_heard_from drop constraint pane_heard_from_source_check;
alter table public.pane_heard_from add constraint pane_heard_from_source_check check (source in (
  'google', 'blog', 'ai_assistant', 'tiktok', 'youtube', 'instagram', 'friend', 'product_hunt_hn', 'github', 'other', 'skipped'));
