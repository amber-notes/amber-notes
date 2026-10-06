-- Note apps (prototype): devices hear about app and app-data changes (an AI's update_page_data
-- through MCP, another device) at once, and pull them, so an open app updates live. The row only
-- triggers a pull; its sealed data isn't read from the realtime message.
alter publication supabase_realtime add table public.note_pages;
