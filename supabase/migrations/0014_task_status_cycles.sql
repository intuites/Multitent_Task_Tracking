-- REVIEW BEFORE APPLYING. Run after 0013.
-- Task statuses become: Not Yet Started (default), Started, Pending, Completed this cycle, Completed (permanently).
-- Escalation stays as the status the escalation workflow sets. Blocked and Cancelled are removed:
--   in_progress -> started, in_review/blocked -> pending, cancelled -> completed.
-- "Completed this cycle" stops reminders until the task's next cycle (its reminder frequency), when it reopens as
-- Not Yet Started and the due date moves forward one period. "Completed" stops reminders and due-date emails for good.

-- ───────── data: move existing tasks to the new statuses
alter table tt_tasks drop constraint if exists tt_tasks_status_check;
alter table tt_tasks disable trigger tt_subtasks_done_guard_trg;
select set_config('tt.rpc', 'on', false);
update tt_tasks set status = 'started' where status = 'in_progress';
update tt_tasks set status = 'pending' where status in ('in_review', 'blocked');
update tt_tasks set status = 'completed', completed_at = coalesce(completed_at, updated_at) where status = 'cancelled';
select set_config('tt.rpc', '', false);
alter table tt_tasks enable trigger tt_subtasks_done_guard_trg;
update tt_task_status_history set from_status = case from_status when 'in_progress' then 'started' when 'in_review' then 'pending' when 'blocked' then 'pending' when 'cancelled' then 'completed' else from_status end,
  to_status = case to_status when 'in_progress' then 'started' when 'in_review' then 'pending' when 'blocked' then 'pending' when 'cancelled' then 'completed' else to_status end
  where from_status in ('in_progress','in_review','blocked','cancelled') or to_status in ('in_progress','in_review','blocked','cancelled');

alter table tt_tasks add constraint tt_tasks_status_check
  check (status in ('not_yet_started','started','pending','escalation','completed_cycle','completed'));
alter table tt_tasks drop constraint if exists tt_tasks_reminder_frequency_check;
alter table tt_tasks add constraint tt_tasks_reminder_frequency_check
  check (reminder_frequency in ('once','daily','weekdays','weekly','monthly','quarterly','semiannual','yearly','custom'));
alter table tt_tasks add column if not exists cycle_done_on date;

drop index if exists tt_tasks_due;
create index if not exists tt_tasks_due on tt_tasks(org_id, due_date) where status not in ('completed','completed_cycle');

-- ───────── workflow: any status to any other (escalation has its own workflow)
create or replace function tt_transition_ok(p_from text, p_to text) returns boolean language sql immutable as $$
  select p_from is distinct from p_to
     and p_from in ('not_yet_started','started','pending','completed_cycle','completed')
     and p_to in ('not_yet_started','started','pending','completed_cycle','completed');
$$;

-- Is `today` one of this schedule's days? Anchored on d0; 29th-31st fall back to the last day of shorter months.
create or replace function tt_cycle_day(p_freq text, p_d0 date, p_every int, p_today date) returns boolean language sql immutable as $$
  select p_today >= p_d0 and case p_freq
    when 'once' then p_today = p_d0
    when 'daily' then true
    when 'weekdays' then extract(isodow from p_today) between 1 and 5
    when 'weekly' then extract(isodow from p_today) = extract(isodow from p_d0)
    else case
      when p_freq = 'custom' then (p_today - p_d0) % greatest(coalesce(p_every, 1), 1) = 0
      when extract(day from p_today) <> least(extract(day from p_d0), extract(day from (date_trunc('month', p_today) + interval '1 month - 1 day')))
        then false
      else ((extract(year from p_today) * 12 + extract(month from p_today)) - (extract(year from p_d0) * 12 + extract(month from p_d0)))::int
           % case p_freq when 'monthly' then 1 when 'quarterly' then 3 when 'semiannual' then 6 when 'yearly' then 12 else 1 end = 0
    end end;
$$;

-- "Completed this cycle" only makes sense for a repeating task; remember the day it was done.
create or replace function tt_cycle_guard() returns trigger language plpgsql as $$
begin
  if new.status = 'completed_cycle' and old.status is distinct from 'completed_cycle' then
    if coalesce(new.reminder_frequency, 'once') = 'once' then
      raise exception 'Completed this cycle is for repeating tasks. Set a reminder frequency, or mark it Completed.';
    end if;
    new.cycle_done_on := (now() at time zone 'America/New_York')::date;
    new.completed_at := now(); new.completed_by := auth.uid(); -- counts on the dashboard's "completed this week"
  end if;
  return new;
end $$;
drop trigger if exists tt_cycle_guard_trg on tt_tasks;
create trigger tt_cycle_guard_trg before update of status on tt_tasks for each row execute function tt_cycle_guard();

-- A parent can't be completed (either way) while a subtask is still open.
create or replace function tt_subtasks_done_guard() returns trigger language plpgsql as $$
begin
  if new.status in ('completed','completed_cycle') and old.status is distinct from new.status
     and exists (select 1 from tt_tasks c where c.parent_task_id = new.id and c.archived_at is null and c.status not in ('completed','completed_cycle')) then
    raise exception 'Finish every subtask before completing this task';
  end if;
  return new;
end $$;

create or replace function tt_resolve_escalation(p_esc uuid, p_next_status text, p_resolution text) returns void
language plpgsql security definer set search_path = public as $$
declare e tt_escalations; t tt_tasks; r text; u uuid;
begin
  select * into e from tt_escalations where id = p_esc for update;
  if not found then raise exception 'Escalation not found'; end if;
  r := tt_role(e.org_id);
  if r is null or (r not in ('owner','admin','manager') and e.owner_id is distinct from auth.uid()) then raise exception 'Not authorized'; end if;
  if e.state in ('resolved','closed') then raise exception 'Escalation is already resolved'; end if;
  if p_next_status is null or p_next_status not in ('not_yet_started','started','pending','completed_cycle','completed') then
    raise exception 'Choose the task status to move to after resolution';
  end if;
  if coalesce(trim(p_resolution), '') = '' then raise exception 'Resolution details are required'; end if;
  select * into t from tt_tasks where id = e.task_id for update;
  update tt_escalations set state = 'resolved', resolved_by = auth.uid(), resolved_at = now(), resolution = trim(p_resolution), resolved_task_status = p_next_status where id = p_esc;
  insert into tt_escalation_updates(org_id, escalation_id, user_id, state, note) values (e.org_id, p_esc, auth.uid(), 'resolved', trim(p_resolution));
  if t.status = 'escalation' then
    perform set_config('tt.rpc', 'on', true);
    update tt_tasks set status = p_next_status,
      completed_at = case when p_next_status = 'completed' then now() else null end,
      completed_by = case when p_next_status = 'completed' then auth.uid() else null end
    where id = t.id;
    insert into tt_task_status_history(org_id, task_id, from_status, to_status, changed_by, reason) values (e.org_id, t.id, 'escalation', p_next_status, auth.uid(), 'Escalation resolved: ' || trim(p_resolution));
  end if;
  perform tt_log(e.org_id, 'task', e.task_id, 'escalation_resolved', jsonb_build_object('next_status', p_next_status));
  for u in select * from tt_task_participants(e.task_id) union select e.raised_by loop
    if u is not null and u <> auth.uid() then
      perform tt_notify(e.org_id, u, 'escalation_resolved', 'Escalation resolved: ' || t.title, p_resolution, '/tasks/' || t.id, null);
    end if;
  end loop;
end $$;

-- ───────── dashboard: "done this cycle" is not open work; "pending" replaces in review / blocked
create or replace function tt_org_summary(p_org uuid, p_day_start timestamptz, p_day_end timestamptz) returns jsonb
language sql stable as $$
  with t as (
    select id, status, priority, due_date from tt_tasks where org_id = p_org and archived_at is null
  ), ot as (
    select * from t where status not in ('completed','completed_cycle')
  )
  select jsonb_build_object(
    'open',       (select count(*) from ot),
    'overdue',    (select count(*) from ot where due_date < now()),
    'due_today',  (select count(*) from ot where due_date >= p_day_start and due_date < p_day_end),
    'pending',    (select count(*) from t where status = 'pending'),
    'by_status',  (select coalesce(jsonb_object_agg(status, c), '{}') from (select status, count(*) c from ot group by 1) s),
    'by_priority',(select coalesce(jsonb_object_agg(priority, c), '{}') from (select priority, count(*) c from ot group by 1) s),
    'workload',   (select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'open', o, 'overdue', od, 'pending', b)), '[]')
                   from (select a.user_id, count(*) o,
                                count(*) filter (where ot.due_date < now()) od,
                                count(*) filter (where ot.status = 'pending') b
                         from ot join tt_task_assignees a on a.task_id = ot.id group by a.user_id) w)
  );
$$;

-- ───────── cron: due-date alerts skip finished tasks (either kind)
create or replace function tt_generate_reminders(p_limit int default 500) returns int
language plpgsql security definer set search_path = public as $$
declare r record; today date; dl date; n int := 0;
begin
  for r in
    select t.id, t.org_id, t.title, t.due_date, a.user_id, o.time_zone as tz
    from tt_tasks t join tt_task_assignees a on a.task_id = t.id join tt_organizations o on o.id = t.org_id
    where t.status not in ('completed','completed_cycle') and t.archived_at is null and t.due_date is not null and t.due_date < now() + interval '24 hours'
    order by t.due_date limit p_limit
  loop
    today := (now() at time zone r.tz)::date; dl := (r.due_date at time zone r.tz)::date;
    if r.due_date < now() then
      perform tt_notify(r.org_id, r.user_id, 'task_overdue', 'Overdue: ' || r.title, null, '/tasks/' || r.id, 'overdue:' || r.id || ':' || today);
    elsif dl = today then
      perform tt_notify(r.org_id, r.user_id, 'due_today', 'Due today: ' || r.title, null, '/tasks/' || r.id, 'duetoday:' || r.id || ':' || today);
    else
      perform tt_notify(r.org_id, r.user_id, 'deadline_upcoming', 'Due soon: ' || r.title, null, '/tasks/' || r.id, 'upcoming:' || r.id || ':' || dl);
    end if;
    n := n + 1;
  end loop;
  for r in
    select e.id, e.org_id, e.owner_id, t.title, e.target_date from tt_escalations e join tt_tasks t on t.id = e.task_id
    where e.state not in ('resolved','closed') and e.owner_id is not null and e.target_date is not null and e.target_date < now() + interval '24 hours'
    limit p_limit
  loop
    perform tt_notify(r.org_id, r.owner_id, 'escalation_due', 'Escalation target approaching: ' || r.title, null, '/escalations', 'escdue:' || r.id || ':' || (r.target_date::date));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function tt_generate_reminders(int) from public, anon, authenticated;
grant execute on function tt_generate_reminders(int) to service_role;

-- ───────── cron: reopen tasks whose next cycle has come, then send today's per-task reminders
create or replace function tt_generate_task_reminders(p_limit int default 500) returns int
language plpgsql security definer set search_path = public as $$
declare r record; local_now timestamp := now() at time zone 'America/New_York'; today date := (now() at time zone 'America/New_York')::date;
  n int := 0; step interval; due timestamptz; i int;
begin
  -- 1. new cycle: "Completed this cycle" -> Not Yet Started, due date moved forward one period (past now)
  perform set_config('tt.rpc', 'on', true);
  for r in
    select t.* from tt_tasks t
    where t.status = 'completed_cycle' and t.archived_at is null and t.cycle_done_on < today
      and tt_cycle_day(t.reminder_frequency, coalesce(t.reminder_start, (t.created_at at time zone 'America/New_York')::date), t.reminder_interval_days, today)
    limit p_limit
  loop
    step := case r.reminder_frequency when 'weekly' then interval '7 days' when 'monthly' then interval '1 month'
      when 'quarterly' then interval '3 months' when 'semiannual' then interval '6 months' when 'yearly' then interval '1 year'
      when 'custom' then make_interval(days => greatest(coalesce(r.reminder_interval_days, 1), 1)) else interval '1 day' end;
    due := r.due_date; i := 0;
    while due is not null and due < now() and i < 1000 loop due := due + step; i := i + 1; end loop;
    update tt_tasks set status = 'not_yet_started', due_date = due, cycle_done_on = null, completed_at = null, completed_by = null where id = r.id;
    insert into tt_task_status_history(org_id, task_id, from_status, to_status, changed_by, reason)
      values (r.org_id, r.id, 'completed_cycle', 'not_yet_started', null, 'New cycle started');
  end loop;

  -- 2. reminders: open tasks only, at or after the reminder time on a schedule day
  for r in
    select t.id, t.org_id, t.title, t.due_date, t.reminder_frequency, a.user_id
    from tt_tasks t
    join tt_task_assignees a on a.task_id = t.id
    cross join lateral (select coalesce(t.reminder_start, (t.created_at at time zone 'America/New_York')::date) as d0) s
    where t.reminder_enabled and t.archived_at is null and t.status not in ('completed','completed_cycle')
      and (coalesce(t.reminder_time, '09:00') <= local_now::time or (t.reminder_frequency = 'once' and today > s.d0))
      and case when t.reminder_frequency = 'once' then today >= s.d0 and today < s.d0 + 7 -- catch-up window if the job was down
               else tt_cycle_day(t.reminder_frequency, s.d0, t.reminder_interval_days, today) end
    limit p_limit
  loop
    perform tt_notify(r.org_id, r.user_id, 'task_reminder', 'Reminder: ' || r.title,
      case when r.due_date is null then null else 'Due ' || to_char(r.due_date at time zone 'America/New_York', 'Mon DD, YYYY') end,
      '/tasks/' || r.id,
      'remind:' || r.id || ':' || r.user_id || ':' || case when r.reminder_frequency = 'once' then 'once' else today::text end);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function tt_generate_task_reminders(int) from public;
