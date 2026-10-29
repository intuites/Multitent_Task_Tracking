-- REVIEW BEFORE APPLYING. Additive only. Per-task reminders and "a task completes only when its subtasks do".
-- Needs 0010 (department_id, notify_emails) first.

alter table tt_tasks add column if not exists reminder_enabled boolean not null default false;
alter table tt_tasks add column if not exists reminder_frequency text check (reminder_frequency in ('daily','weekdays','weekly'));
alter table tt_tasks add column if not exists reminder_time time;

-- A parent task can't be marked Completed while any of its subtasks is still open.
create or replace function tt_subtasks_done_guard() returns trigger language plpgsql as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed'
     and exists (select 1 from tt_tasks c where c.parent_task_id = new.id and c.archived_at is null and c.status not in ('completed','cancelled')) then
    raise exception 'Finish or cancel every subtask before completing this task';
  end if;
  return new;
end $$;
drop trigger if exists tt_subtasks_done_guard_trg on tt_tasks;
create trigger tt_subtasks_done_guard_trg before update of status on tt_tasks for each row execute function tt_subtasks_done_guard();

-- Called by the scheduled job. Times are US Eastern; the dedup key makes it send at most once per task, person and day.
create or replace function tt_generate_task_reminders(p_limit int default 500) returns int
language plpgsql security definer set search_path = public as $$
declare r record; local_now timestamp := now() at time zone 'America/New_York'; n int := 0;
begin
  for r in
    select t.id, t.org_id, t.title, t.due_date, t.reminder_frequency, t.created_at, a.user_id
    from tt_tasks t join tt_task_assignees a on a.task_id = t.id
    where t.reminder_enabled and t.archived_at is null and t.status not in ('completed','cancelled')
      and coalesce(t.reminder_time, '09:00') <= local_now::time
      and (t.reminder_frequency = 'daily'
           or (t.reminder_frequency = 'weekdays' and extract(isodow from local_now) between 1 and 5)
           or (t.reminder_frequency = 'weekly' and extract(isodow from local_now) = extract(isodow from t.created_at at time zone 'America/New_York')))
    limit p_limit
  loop
    perform tt_notify(r.org_id, r.user_id, 'task_reminder', 'Reminder: ' || r.title,
      case when r.due_date is null then null else 'Due ' || to_char(r.due_date at time zone 'America/New_York', 'Mon DD, YYYY') end,
      '/tasks/' || r.id, 'remind:' || r.id || ':' || r.user_id || ':' || local_now::date);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function tt_generate_task_reminders(int) from public;


-- CC emails: queue one email per address when a task is created (by hand or from a template).
create or replace function tt_task_cc_emails() returns trigger language plpgsql security definer set search_path = public as $$
declare e text;
begin
  foreach e in array coalesce(new.notify_emails, '{}') loop
    insert into tt_email_delivery_logs(org_id, to_email, subject, body, dedup_key)
    values (new.org_id, e, 'New task: ' || new.title, coalesce(new.description, ''), 'cc:' || new.id || ':' || e);
  end loop;
  return new;
end $$;
drop trigger if exists tt_task_cc_emails_trg on tt_tasks;
create trigger tt_task_cc_emails_trg after insert on tt_tasks for each row execute function tt_task_cc_emails();

-- Team leads: whenever someone is assigned, the lead of each of their teams is told (in-app, and by email per their settings).
create or replace function tt_notify_assignee_leads() returns trigger language plpgsql security definer set search_path = public as $$
declare t tt_tasks; lead uuid;
begin
  select * into t from tt_tasks where id = new.task_id;
  for lead in select distinct tm.manager_id from tt_team_members m join tt_teams tm on tm.id = m.team_id
              where m.user_id = new.user_id and tm.org_id = t.org_id and tm.manager_id is not null and tm.manager_id <> new.user_id loop
    perform tt_notify(t.org_id, lead, 'task_assigned', 'Your team member was assigned: ' || t.title, null, '/tasks/' || t.id, 'lead:' || t.id || ':' || lead);
  end loop;
  return new;
end $$;
drop trigger if exists tt_notify_assignee_leads_trg on tt_task_assignees;
create trigger tt_notify_assignee_leads_trg after insert on tt_task_assignees for each row execute function tt_notify_assignee_leads();

-- Same template function as 0010, minus its own lead/email steps (the triggers handle them, so nothing is sent twice).
create or replace function tt_create_from_template(
  p_template uuid, p_title text default null, p_department uuid default null, p_assignee uuid default null,
  p_client uuid default null, p_project uuid default null, p_start date default null, p_extra_emails text[] default '{}'
) returns uuid language plpgsql security definer set search_path = public as $$
declare tpl tt_task_templates; v_task uuid; v_sub uuid; s jsonb; who uuid; base date := coalesce(p_start, current_date);
begin
  select * into tpl from tt_task_templates where id = p_template;
  if not found then raise exception 'Template not found'; end if;
  if coalesce(tt_role(tpl.org_id), '') not in ('owner','admin','manager') then raise exception 'Not authorized'; end if;
  who := coalesce(p_assignee, tpl.assignee_id);
  if who is not null and not exists (select 1 from tt_org_members where org_id = tpl.org_id and user_id = who and active) then
    raise exception 'Assignee must be an active member';
  end if;
  if p_department is not null and not exists (select 1 from tt_departments where id = p_department and org_id = tpl.org_id) then
    raise exception 'Department not found';
  end if;

  insert into tt_tasks(org_id, client_id, project_id, department_id, title, description, priority, start_date, due_date, notify_emails, created_by)
  values (tpl.org_id, p_client, p_project, coalesce(p_department, tpl.department_ids[1]), left(coalesce(nullif(trim(p_title), ''), tpl.title), 200), tpl.description,
          tpl.priority, base, case when tpl.due_offset_days is null then null else (base + tpl.due_offset_days)::timestamptz end,
          (select coalesce(array_agg(distinct x), '{}') from unnest(tpl.notify_emails || coalesce(p_extra_emails, '{}')) x where x ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
          auth.uid())
  returning id into v_task;
  if who is not null then perform tt_assign(v_task, who, true); end if;

  for s in select * from jsonb_array_elements(tpl.subtasks) loop
    insert into tt_tasks(org_id, client_id, project_id, department_id, parent_task_id, title, priority, start_date, due_date, created_by)
    values (tpl.org_id, p_client, p_project, coalesce(p_department, tpl.department_ids[1]), v_task, left(coalesce(s->>'title', 'Subtask'), 200), tpl.priority,
            base + coalesce((s->>'start_offset_days')::int, 0),
            case when s ? 'due_offset_days' and s->>'due_offset_days' is not null then (base + (s->>'due_offset_days')::int)::timestamptz end, auth.uid())
    returning id into v_sub;
    if coalesce((s->>'assignee_id')::uuid, who) is not null then perform tt_assign(v_sub, coalesce((s->>'assignee_id')::uuid, who), true); end if;
  end loop;

  -- lead notifications and CC emails now come from the triggers above, for every task
  perform tt_log(tpl.org_id, 'task', v_task, 'created_from_template', jsonb_build_object('template', tpl.name));
  return v_task;
end $$;
