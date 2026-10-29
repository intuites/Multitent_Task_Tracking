-- REVIEW BEFORE APPLYING. Additive only. Run after 0012.
-- More reminder frequencies: once, monthly, quarterly, yearly and custom (every N days), anchored on a start date.

alter table tt_tasks drop constraint if exists tt_tasks_reminder_frequency_check;
alter table tt_tasks add constraint tt_tasks_reminder_frequency_check
  check (reminder_frequency in ('once','daily','weekdays','weekly','monthly','quarterly','yearly','custom'));
alter table tt_tasks add column if not exists reminder_start date;
alter table tt_tasks add column if not exists reminder_interval_days int check (reminder_interval_days between 1 and 365);

-- Called by the scheduled job. Times are US Eastern; the dedup key makes it send at most once per task, person and day
-- ("once" reminders get a single key, so they still go out within a week if the job missed the exact day).
-- Monthly/quarterly/yearly on the 29th-31st fall back to the last day of shorter months.
create or replace function tt_generate_task_reminders(p_limit int default 500) returns int
language plpgsql security definer set search_path = public as $$
declare r record; local_now timestamp := now() at time zone 'America/New_York'; today date := (now() at time zone 'America/New_York')::date; n int := 0;
begin
  for r in
    select t.id, t.org_id, t.title, t.due_date, t.reminder_frequency, a.user_id
    from tt_tasks t
    join tt_task_assignees a on a.task_id = t.id
    cross join lateral (select coalesce(t.reminder_start, (t.created_at at time zone 'America/New_York')::date) as d0) s
    cross join lateral (select
        extract(day from today) = least(extract(day from s.d0), extract(day from (date_trunc('month', today) + interval '1 month - 1 day'))) as same_dom,
        (extract(year from today) * 12 + extract(month from today)) - (extract(year from s.d0) * 12 + extract(month from s.d0)) as months) m
    where t.reminder_enabled and t.archived_at is null and t.status not in ('completed','cancelled')
      and today >= s.d0
      and (coalesce(t.reminder_time, '09:00') <= local_now::time or (t.reminder_frequency = 'once' and today > s.d0))
      and case t.reminder_frequency
        when 'once' then today < s.d0 + 7 -- catch-up window if the job was down; the dedup key stops repeats
        when 'daily' then true
        when 'weekdays' then extract(isodow from today) between 1 and 5
        when 'weekly' then extract(isodow from today) = extract(isodow from s.d0)
        when 'monthly' then m.same_dom
        when 'quarterly' then m.same_dom and m.months % 3 = 0
        when 'yearly' then m.same_dom and m.months % 12 = 0
        when 'custom' then (today - s.d0) % greatest(coalesce(t.reminder_interval_days, 1), 1) = 0
        else false end
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
