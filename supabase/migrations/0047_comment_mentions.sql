-- @mentions in task comments. Typing @ in a comment offers the task's assignees; the people picked are saved
-- in `mentions` and get a "mentioned you" notice in the app and by email (their Notifications switches apply).
-- The database decides who is notified: only active members who are assignees of that task, never the author.
-- A mentioned assignee gets the mention instead of the usual "New comment" notice, not both.
-- Safe to run more than once.

alter table tt_task_comments add column if not exists mentions uuid[] not null default '{}';
alter table tt_task_comments drop constraint if exists tt_comment_mentions_max;
alter table tt_task_comments add constraint tt_comment_mentions_max check (cardinality(mentions) <= 50);

create or replace function tt_comment_after() returns trigger language plpgsql security definer set search_path = public as $$
declare t record; u uuid; m uuid[];
begin
  select id, title into t from tt_tasks where id = new.task_id;
  select coalesce(array_agg(distinct x), '{}') into m
  from unnest(coalesce(new.mentions, '{}')) x
  where x <> new.user_id
    and exists (select 1 from tt_task_assignees a where a.task_id = new.task_id and a.user_id = x)
    and exists (select 1 from tt_org_members om where om.org_id = new.org_id and om.user_id = x and om.active);
  foreach u in array m loop
    perform tt_notify(new.org_id, u, 'task_mention', coalesce(new.author_name, 'Someone') || ' mentioned you on ' || t.title,
      left(new.body, 200), '/tasks/' || t.id, 'mention:' || new.id || ':' || u);
  end loop;
  for u in select * from tt_task_participants(new.task_id) loop
    if u <> new.user_id and not (u = any(m)) then
      perform tt_notify(new.org_id, u, 'task_comment', 'New comment on ' || t.title, left(new.body, 200), '/tasks/' || t.id, 'comment:' || new.id || ':' || u);
    end if;
  end loop;
  return null;
end $$;
