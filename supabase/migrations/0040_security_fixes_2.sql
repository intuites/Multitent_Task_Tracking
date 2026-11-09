-- REVIEW BEFORE APPLYING. Run after 0039. Safe to run more than once.
-- Fixes from the November 2026 review:
--   1. tt_assign, tt_set_recurrence and tt_add_dependency let anyone who isn't a member through: tt_role() is null
--      for them and "null not in (...)" is not true, so the check never raised. Now coalesce, like the other functions.
--      tt_assign also emails a person again when they're re-assigned after being unassigned.
--   2. Employees could add themselves as a watcher of any task and so read it; activity logs were readable by every member.
--   3. A comment could be moved to another task or organization, or have its author or another person's text changed.
--   4. Removed or deactivated members kept getting completed-task emails and digests as lead or manager, and stayed on
--      repeating tasks, so each new copy assigned and emailed them.
--   5. Deleting an organization skipped the organization's two-factor requirement for its creator.
--   6. Organization admins could read the review emails sent to platform admins (their addresses) in the email log.
--   7. An email could go out twice when the instant send and the 5-minute job picked it up at the same moment:
--      a row being sent is now marked 'sending' (with claimed_at), so other runs skip it.

-- ───────── 1
create or replace function tt_assign(p_task uuid, p_user uuid, p_add boolean default true, p_email text default null) returns void
language plpgsql security definer set search_path = public as $$
declare t tt_tasks; em text := nullif(lower(trim(p_email)), ''); prev tt_task_assignees;
begin
  select * into t from tt_tasks where id = p_task;
  if not found then raise exception 'Task not found'; end if;
  if coalesce(tt_role(t.org_id), '') not in ('owner','admin') then raise exception 'Not authorized'; end if;
  if not exists (select 1 from tt_org_members where org_id = t.org_id and user_id = p_user and active) then
    raise exception 'User is not an active member of this organization';
  end if;
  if em is not null then
    if em = (select lower(email) from auth.users where id = p_user) then em := null;
    elsif not exists (select 1 from tt_member_emails where org_id = t.org_id and user_id = p_user and email = em) then
      raise exception 'That email isn''t one of this person''s addresses';
    end if;
  end if;
  select * into prev from tt_task_assignees where task_id = p_task and user_id = p_user;
  if p_add then
    insert into tt_task_assignees(task_id, user_id, assigned_by, email) values (p_task, p_user, auth.uid(), em)
      on conflict (task_id, user_id) do update set email = excluded.email;
    -- newly assigned, or now sent to another address: tell them (the time in the key lets a re-assignment email again)
    if p_user <> auth.uid() and (prev.user_id is null or prev.email is distinct from em) then
      perform tt_notify(t.org_id, p_user, 'task_assigned', 'You were assigned: ' || t.title, null, '/tasks/' || p_task,
        'assign:' || p_task || ':' || p_user || ':' || extract(epoch from clock_timestamp())::bigint);
    end if;
  else
    delete from tt_task_assignees where task_id = p_task and user_id = p_user;
    if p_user <> auth.uid() and prev.user_id is not null then perform tt_notify(t.org_id, p_user, 'task_assignment_changed', 'You were unassigned from: ' || t.title, null, '/tasks/' || p_task, null); end if;
  end if;
  perform tt_log(t.org_id, 'task', p_task, case when p_add then 'assignee_added' else 'assignee_removed' end, jsonb_build_object('user', p_user));
end $$;

create or replace function tt_set_recurrence(p_task uuid, p_freq text, p_n int, p_until date default null) returns void
language plpgsql security definer set search_path = public as $$
declare t tt_tasks; tz text;
begin
  select * into t from tt_tasks where id = p_task;
  if not found then raise exception 'Task not found'; end if;
  if coalesce(tt_role(t.org_id), '') not in ('owner','admin') then raise exception 'Not authorized'; end if;
  if p_freq is null then delete from tt_task_recurrence where task_id = p_task; return; end if;
  select time_zone into tz from tt_organizations where id = t.org_id;
  insert into tt_task_recurrence(task_id, org_id, frequency, interval_n, next_run, until_date)
  values (p_task, t.org_id, p_freq, p_n, tt_next_run(coalesce(t.due_date, now()), p_freq, p_n, tz), p_until)
  on conflict (task_id) do update set frequency = excluded.frequency, interval_n = excluded.interval_n, until_date = excluded.until_date, active = true;
  perform tt_log(t.org_id, 'task', p_task, 'recurrence_set', jsonb_build_object('frequency', p_freq, 'every', p_n));
end $$;

create or replace function tt_add_dependency(p_task uuid, p_blocker uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a tt_tasks; b tt_tasks; cyc boolean;
begin
  select * into a from tt_tasks where id = p_task; select * into b from tt_tasks where id = p_blocker;
  if a.id is null or b.id is null then raise exception 'Task not found'; end if;
  if a.org_id <> b.org_id then raise exception 'Tasks must be in the same organization'; end if;
  if coalesce(tt_role(a.org_id), '') not in ('owner','admin') then raise exception 'Not authorized'; end if;
  if p_task = p_blocker then raise exception 'A task cannot depend on itself'; end if;
  with recursive up as (
    select blocked_by_id as id from tt_task_dependencies where task_id = p_blocker
    union select d.blocked_by_id from tt_task_dependencies d join up on d.task_id = up.id)
  select exists (select 1 from up where id = p_task) into cyc;
  if cyc then raise exception 'This dependency would create a circular chain'; end if;
  insert into tt_task_dependencies(task_id, blocked_by_id, org_id, created_by) values (p_task, p_blocker, a.org_id, auth.uid()) on conflict do nothing;
  perform tt_log(a.org_id, 'task', p_task, 'dependency_added', jsonb_build_object('blocked_by', p_blocker));
end $$;

revoke execute on function tt_assign(uuid, uuid, boolean, text) from public, anon;
grant execute on function tt_assign(uuid, uuid, boolean, text) to authenticated;
revoke execute on function tt_set_recurrence(uuid, text, int, date) from public, anon;
grant execute on function tt_set_recurrence(uuid, text, int, date) to authenticated;
revoke execute on function tt_add_dependency(uuid, uuid) from public, anon;
grant execute on function tt_add_dependency(uuid, uuid) to authenticated;

-- ───────── 2
-- watch only a task you can already see (admins can add anyone in their organization)
drop policy if exists watchers_self on tt_task_watchers;
create policy watchers_self on tt_task_watchers for all
  using (user_id = auth.uid() or exists (select 1 from tt_tasks t where t.id = task_id and tt_is_org_member(t.org_id, array['owner','admin'])))
  with check (exists (select 1 from tt_tasks t where t.id = task_id and (
    tt_is_org_member(t.org_id, array['owner','admin']) or (user_id = auth.uid() and tt_can_see_task(t.id)))));

-- admins read the whole log; everyone else their own entries and those of tasks they can see
drop policy if exists activity_read on tt_activity_logs;
create policy activity_read on tt_activity_logs for select using (
  tt_is_org_member(org_id, array['owner','admin'])
  or (tt_is_org_member(org_id) and (actor_id = auth.uid() or (entity_type = 'task' and tt_can_see_task(entity_id)))));

-- ───────── 3
drop policy if exists comments_update on tt_task_comments;
create policy comments_update on tt_task_comments for update
  using (user_id = auth.uid() or tt_is_org_member(org_id, array['owner','admin']))
  with check (user_id = auth.uid() or tt_is_org_member(org_id, array['owner','admin']));

create or replace function tt_comment_guard() returns trigger language plpgsql as $$
begin
  if auth.uid() is null or coalesce(current_setting('tt.rpc', true), '') = 'on' then return new; end if;
  if new.org_id is distinct from old.org_id or new.task_id is distinct from old.task_id or new.user_id is distinct from old.user_id then
    raise exception 'A comment can''t be moved or given another author';
  end if;
  -- admins may delete anyone's comment, but only the author changes what it says
  if new.body is distinct from old.body and old.user_id <> auth.uid() then
    raise exception 'Only the author can edit a comment';
  end if;
  return new;
end $$;
drop trigger if exists tt_comment_guard_trg on tt_task_comments;
create trigger tt_comment_guard_trg before update on tt_task_comments for each row execute function tt_comment_guard();

-- ───────── 4
create or replace function tt_member_left() returns trigger language plpgsql security definer set search_path = public as $$
declare o uuid := coalesce(new.org_id, old.org_id); u uuid := coalesce(new.user_id, old.user_id);
begin
  if tg_op = 'UPDATE' and (new.active or not old.active) then return new; end if;
  perform set_config('tt.rpc', 'on', true);
  update tt_tasks set lead_id = null where org_id = o and lead_id = u;
  update tt_tasks set manager_id = null where org_id = o and manager_id = u;
  -- off repeating tasks, so the next copies don't assign them again; one-off tasks keep their history
  delete from tt_task_assignees a using tt_task_recurrence r, tt_tasks t
    where a.user_id = u and a.task_id = r.task_id and r.active and t.id = r.task_id and t.org_id = o;
  return coalesce(new, old);
end $$;
drop trigger if exists tt_member_left_trg on tt_org_members;
create trigger tt_member_left_trg after update of active or delete on tt_org_members for each row execute function tt_member_left();

-- the same for people who already left
select set_config('tt.rpc', 'on', false);
update tt_tasks t set lead_id = null where lead_id is not null
  and not exists (select 1 from tt_org_members m where m.org_id = t.org_id and m.user_id = t.lead_id and m.active);
update tt_tasks t set manager_id = null where manager_id is not null
  and not exists (select 1 from tt_org_members m where m.org_id = t.org_id and m.user_id = t.manager_id and m.active);
delete from tt_task_assignees a using tt_task_recurrence r, tt_tasks t
  where a.task_id = r.task_id and r.active and t.id = r.task_id
    and not exists (select 1 from tt_org_members m where m.org_id = t.org_id and m.user_id = a.user_id and m.active);
select set_config('tt.rpc', '', false);

-- ───────── 5
drop policy if exists org_delete on tt_organizations;
create policy org_delete on tt_organizations for delete to authenticated
  using ((created_by = auth.uid() and not tt_mfa_missing(id)) or tt_is_platform_admin());

-- ───────── 6
drop policy if exists email_logs_admin on tt_email_delivery_logs;
create policy email_logs_admin on tt_email_delivery_logs for select
  using (tt_is_org_member(org_id, array['owner','admin']) and coalesce(kind, '') <> 'org_review');

-- ───────── 7
alter table tt_email_delivery_logs add column if not exists claimed_at timestamptz;
alter table tt_email_delivery_logs drop constraint if exists tt_email_delivery_logs_status_check;
alter table tt_email_delivery_logs add constraint tt_email_delivery_logs_status_check check (status in ('pending','sending','sent','failed'));
