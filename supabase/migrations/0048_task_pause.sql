-- Pause a task until a date.
-- Admins and platform admins pause and resume (tt_pause_task, tt_resume_task). On the chosen date, in the organization's
-- time zone, the 5-minute job resumes it (tt_resume_paused_tasks, called from /api/cron/tick).
-- Everyone assigned is told when it is paused and again when it resumes.
-- While paused: no reminder or due-date emails for it, and only admins can change its status or the pause itself.

alter table tt_tasks add column if not exists paused_until date;
alter table tt_tasks add column if not exists paused_by uuid references auth.users(id) on delete set null;
alter table tt_tasks add column if not exists paused_at timestamptz;
create index if not exists tt_tasks_paused_until on tt_tasks (paused_until) where paused_until is not null;

-- ───────── guard: the pause columns change only through the functions below; status stays with admins while paused
create or replace function tt_task_pause_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if (new.paused_until, new.paused_by, new.paused_at) is distinct from (old.paused_until, old.paused_by, old.paused_at)
     and coalesce(current_setting('tt.pause', true), '') <> 'on' and auth.uid() is not null then
    raise exception 'Pause or resume a task with the Pause button';
  end if;
  -- server jobs (no signed-in user, like the cycle reopen) are not blocked
  if old.paused_until is not null and new.status is distinct from old.status and auth.uid() is not null
     and not tt_is_org_member(new.org_id, array['owner', 'admin']) then
    raise exception 'This task is paused until %. An admin can resume it.', to_char(old.paused_until, 'Mon DD, YYYY');
  end if;
  return new;
end $$;
drop trigger if exists tt_task_pause_guard on tt_tasks;
create trigger tt_task_pause_guard before update on tt_tasks for each row execute function tt_task_pause_guard();

-- ───────── clear the pause, log it, and tell everyone assigned (p_actor null: resumed by the date)
create or replace function tt_unpause(p_task uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t record; a record;
begin
  select * into t from tt_tasks where id = p_task;
  if not found or t.paused_until is null then return; end if;
  perform set_config('tt.pause', 'on', true);
  update tt_tasks set paused_until = null, paused_by = null, paused_at = null where id = p_task;
  insert into tt_activity_logs(org_id, actor_id, entity_type, entity_id, action, detail)
    values (t.org_id, p_actor, 'task', p_task, 'resumed', jsonb_build_object('auto', p_actor is null, 'until', t.paused_until));
  -- a task finished while it was paused needs no "resumed" message
  if t.status in ('completed', 'completed_cycle') or t.archived_at is not null then return; end if;
  for a in select user_id from tt_task_assignees where task_id = p_task loop
    perform tt_notify(t.org_id, a.user_id, 'task_resumed', 'Resumed: ' || t.title,
      case when p_actor is null then 'The pause has ended and this task is active again.' else 'An admin resumed this task. It is active again.' end
        || case when t.due_date is null then '' else ' Due ' || to_char(t.due_date, 'Mon DD, YYYY') || '.' end,
      '/tasks/' || p_task, 'resumed:' || p_task || ':' || a.user_id || ':' || now()::date);
  end loop;
end $$;
revoke execute on function tt_unpause(uuid, uuid) from public, anon, authenticated;

-- ───────── pause (admins and platform admins)
create or replace function tt_pause_task(p_task uuid, p_until date) returns void
language plpgsql security definer set search_path = public as $$
declare t record; today date; a record;
begin
  select tk.*, o.time_zone as tz into t from tt_tasks tk join tt_organizations o on o.id = tk.org_id where tk.id = p_task;
  if not found or not tt_is_org_member(t.org_id, array['owner', 'admin']) then raise exception 'Only admins can pause a task'; end if;
  if t.status in ('completed', 'completed_cycle') then raise exception 'Only open tasks can be paused'; end if;
  today := (now() at time zone coalesce(t.tz, 'UTC'))::date;
  if p_until is null or p_until <= today then raise exception 'Pick a resume date after today'; end if;
  if p_until > today + 730 then raise exception 'Pick a resume date within two years'; end if;
  perform set_config('tt.pause', 'on', true);
  update tt_tasks set paused_until = p_until, paused_by = auth.uid(), paused_at = now() where id = p_task;
  insert into tt_activity_logs(org_id, actor_id, entity_type, entity_id, action, detail)
    values (t.org_id, auth.uid(), 'task', p_task, 'paused', jsonb_build_object('until', p_until));
  for a in select user_id from tt_task_assignees where task_id = p_task loop
    perform tt_notify(t.org_id, a.user_id, 'task_paused', 'Paused until ' || to_char(p_until, 'Mon DD') || ': ' || t.title,
      'This task is on hold. It resumes on ' || to_char(p_until, 'FMDay, Mon DD, YYYY') || ', and you will be told when it does.',
      '/tasks/' || p_task, 'paused:' || p_task || ':' || a.user_id || ':' || p_until);
  end loop;
end $$;
revoke execute on function tt_pause_task(uuid, date) from public, anon;
grant execute on function tt_pause_task(uuid, date) to authenticated;

-- ───────── resume now (admins and platform admins)
create or replace function tt_resume_task(p_task uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o uuid;
begin
  select org_id into o from tt_tasks where id = p_task;
  if o is null or not tt_is_org_member(o, array['owner', 'admin']) then raise exception 'Only admins can resume a task'; end if;
  perform tt_unpause(p_task, auth.uid());
end $$;
revoke execute on function tt_resume_task(uuid) from public, anon;
grant execute on function tt_resume_task(uuid) to authenticated;

-- ───────── the job: resume every task whose date has come in its organization's time zone
create or replace function tt_resume_paused_tasks(p_limit int default 200) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in
    select t.id from tt_tasks t join tt_organizations o on o.id = t.org_id
    where t.paused_until is not null and t.paused_until <= (now() at time zone coalesce(o.time_zone, 'UTC'))::date
    order by t.paused_until limit p_limit
  loop
    perform tt_unpause(r.id, null);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function tt_resume_paused_tasks(int) from public, anon, authenticated;
grant execute on function tt_resume_paused_tasks(int) to service_role;

-- ───────── no reminder or due-date messages while a task is paused (same tt_notify as 0035, plus the first check)
create or replace function tt_notify(p_org uuid, p_user uuid, p_type text, p_title text, p_body text, p_link text, p_dedup text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_in_app boolean; v_email boolean; em text;
begin
  if p_type in ('task_reminder', 'task_overdue', 'due_today', 'deadline_upcoming') and p_link ~ '^/tasks/[0-9a-fA-F-]{36}$'
     and exists (select 1 from tt_tasks where id = substr(p_link, 8)::uuid and paused_until is not null) then
    return;
  end if;
  select in_app, email into v_in_app, v_email from tt_notification_preferences where user_id = p_user and org_id = p_org and type = p_type;
  if not found then v_in_app := true; v_email := true; end if;
  if v_in_app then
    insert into tt_notifications(org_id, user_id, type, title, body, link, dedup_key)
    values (p_org, p_user, p_type, p_title, p_body, p_link, p_dedup) on conflict (user_id, dedup_key) do nothing;
  end if;
  if v_email then
    if p_link ~ '^/tasks/[0-9a-fA-F-]{36}$' then
      select a.email into em from tt_task_assignees a where a.task_id = substr(p_link, 8)::uuid and a.user_id = p_user;
    end if;
    if em is null then select email into em from tt_profiles where user_id = p_user; end if;
    if em is not null then
      insert into tt_email_delivery_logs(org_id, user_id, to_email, subject, body, dedup_key, kind, link)
      values (p_org, p_user, em, p_title, coalesce(p_body, p_title), p_dedup, p_type, p_link) on conflict (user_id, dedup_key) do nothing;
    end if;
  end if;
end $$;
revoke execute on function tt_notify(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
