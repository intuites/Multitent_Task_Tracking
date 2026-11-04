-- Live updates: also broadcast comments, notifications and organization settings such as the brand color
-- (tasks and assignees joined in 0016). Safe to run more than once.
-- Realtime applies each table's RLS to every subscriber, so people only hear about rows they can already read.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['tt_tasks', 'tt_task_assignees', 'tt_task_comments', 'tt_notifications', 'tt_organizations'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
