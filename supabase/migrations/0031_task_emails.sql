-- Task emails: Lead and Manager on each task, and email rows that remember what they are about, so the
-- sender can draw them as styled emails (task created, reminder, completed permanently, digests).
-- Safe to run more than once.

-- ───────── Lead and Manager: ordinary members, no extra permissions; they receive the completed email and digests
alter table tt_tasks add column if not exists lead_id uuid references auth.users(id) on delete set null;
alter table tt_tasks add column if not exists manager_id uuid references auth.users(id) on delete set null;
create index if not exists tt_tasks_lead on tt_tasks(org_id, lead_id) where lead_id is not null;
create index if not exists tt_tasks_manager on tt_tasks(org_id, manager_id) where manager_id is not null;

-- both must belong to the task's organization, so nobody can point a task at another tenant's people
create or replace function tt_task_people_guard() returns trigger language plpgsql as $$
begin
  if new.lead_id is not null and not exists (select 1 from tt_org_members where org_id = new.org_id and user_id = new.lead_id) then
    raise exception 'The lead must be a member of this organization';
  end if;
  if new.manager_id is not null and not exists (select 1 from tt_org_members where org_id = new.org_id and user_id = new.manager_id) then
    raise exception 'The manager must be a member of this organization';
  end if;
  return new;
end $$;
drop trigger if exists tt_task_people_guard_trg on tt_tasks;
create trigger tt_task_people_guard_trg before insert or update of lead_id, manager_id, org_id on tt_tasks
  for each row execute function tt_task_people_guard();

-- ───────── email rows: kind (the notification type), link (the task), html (prebuilt, for digests)
alter table tt_email_delivery_logs add column if not exists kind text;
alter table tt_email_delivery_logs add column if not exists link text;
alter table tt_email_delivery_logs add column if not exists html text;

create or replace function tt_notify(p_org uuid, p_user uuid, p_type text, p_title text, p_body text, p_link text, p_dedup text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_in_app boolean; v_email boolean; em text;
begin
  select in_app, email into v_in_app, v_email from tt_notification_preferences where user_id = p_user and org_id = p_org and type = p_type;
  if not found then v_in_app := true; v_email := true; end if;
  if v_in_app then
    insert into tt_notifications(org_id, user_id, type, title, body, link, dedup_key)
    values (p_org, p_user, p_type, p_title, p_body, p_link, p_dedup) on conflict (user_id, dedup_key) do nothing;
  end if;
  if v_email then
    select email into em from tt_profiles where user_id = p_user;
    if em is not null then
      insert into tt_email_delivery_logs(org_id, user_id, to_email, subject, body, dedup_key, kind, link)
      values (p_org, p_user, em, p_title, coalesce(p_body, p_title), p_dedup, p_type, p_link) on conflict (user_id, dedup_key) do nothing;
    end if;
  end if;
end $$;

-- CC addresses get the same "new task" email
create or replace function tt_task_cc_emails() returns trigger language plpgsql security definer set search_path = public as $$
declare e text;
begin
  foreach e in array coalesce(new.notify_emails, '{}') loop
    insert into tt_email_delivery_logs(org_id, to_email, subject, body, dedup_key, kind, link)
    values (new.org_id, e, 'New task: ' || new.title, coalesce(new.description, ''), 'cc:' || new.id || ':' || e, 'task_assigned', '/tasks/' || new.id);
  end loop;
  return new;
end $$;

-- ───────── Completed (permanently): the task's Lead and Manager get the completed email with its history.
-- Assignees, watchers and the creator already hear about every status change from tt_set_task_status,
-- and the sender draws that one as the completed email too, so nobody is told twice.
create or replace function tt_task_completed_emails() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    for u in select distinct x from unnest(array[new.lead_id, new.manager_id]) x
             where x is not null and x is distinct from auth.uid() and x not in (select * from tt_task_participants(new.id)) loop
      perform tt_notify(new.org_id, u, 'task_completed', new.title || ' is completed', null, '/tasks/' || new.id,
        'done:' || new.id || ':' || u || ':' || extract(epoch from now())::bigint);
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists tt_task_completed_emails_trg on tt_tasks;
create trigger tt_task_completed_emails_trg after update of status on tt_tasks for each row execute function tt_task_completed_emails();
