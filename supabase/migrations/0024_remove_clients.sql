-- REVIEW BEFORE APPLYING. Run after 0023.
-- Clients and the client portal are gone. Inside an organization there are only admins and employees;
-- platform admins sit outside every organization.
-- DESTRUCTIVE: deletes every client, client contact and client note, files attached to a client,
-- and the client link on tasks and projects. Comments and files lose their internal/client visibility flag.

begin;

-- ───────── portal access rules (they read the columns and functions dropped below)
drop policy if exists portal_projects on tt_projects;
drop policy if exists portal_milestones on tt_project_milestones;
drop policy if exists portal_tasks on tt_tasks;
drop policy if exists portal_comments_read on tt_task_comments;
drop policy if exists portal_comments_insert on tt_task_comments;
drop policy if exists portal_files_read on tt_files;
drop policy if exists portal_files_insert on tt_files;
drop policy if exists portal_approvals_read on tt_approvals;
drop policy if exists tt_files_portal_read on storage.objects;
drop policy if exists tt_files_portal_insert on storage.objects;

drop function if exists tt_portal_submit_request(uuid, text, text);
drop function if exists tt_portal_update_contact(text, text);
drop function if exists tt_portal_task_visible(uuid);
drop function if exists tt_portal_project_visible(uuid);
drop function if exists tt_portal_client_ids();
-- approvals were removed from the app in 0007; these two still pointed at client contacts
drop function if exists tt_request_approval(uuid, uuid, uuid);
drop function if exists tt_decide_approval(uuid, boolean, text);

-- ───────── functions that copied or read client fields
create or replace function tt_comment_after() returns trigger language plpgsql security definer set search_path = public as $$
declare t record; u uuid;
begin
  select id, title into t from tt_tasks where id = new.task_id;
  for u in select * from tt_task_participants(new.task_id) loop
    if u <> new.user_id then
      perform tt_notify(new.org_id, u, 'task_comment', 'New comment on ' || t.title, left(new.body, 200), '/tasks/' || t.id, 'comment:' || new.id || ':' || u);
    end if;
  end loop;
  return null;
end $$;

create or replace function tt_generate_recurrences(p_limit int default 100) returns int
language plpgsql security definer set search_path = public as $$
declare r record; tz text; slot timestamptz; nxt timestamptz; occ date; new_id uuid; n int := 0; u uuid;
begin
  for r in select * from tt_task_recurrence where active and next_run <= now() order by next_run limit p_limit for update skip locked loop
    select time_zone into tz from tt_organizations where id = r.org_id;
    slot := r.next_run;
    loop
      nxt := tt_next_run(slot, r.frequency, r.interval_n, tz);
      exit when nxt > now();
      slot := nxt;
    end loop;
    occ := (slot at time zone tz)::date;
    if r.until_date is null or occ <= r.until_date then
      new_id := null;
      insert into tt_tasks(org_id, project_id, title, description, priority, tags, requires_approval, estimated_hours, created_by, due_date, recurrence_parent_id, occurrence_date)
      select org_id, project_id, title, description, priority, tags, requires_approval, estimated_hours, created_by, slot, r.task_id, occ
      from tt_tasks where id = r.task_id
      on conflict (recurrence_parent_id, occurrence_date) do nothing returning id into new_id;
      if new_id is not null then
        insert into tt_task_assignees(task_id, user_id) select new_id, user_id from tt_task_assignees where task_id = r.task_id on conflict do nothing;
        for u in select user_id from tt_task_assignees where task_id = new_id loop
          perform tt_notify(r.org_id, u, 'task_assigned', 'Recurring task created', null, '/tasks/' || new_id, 'recur:' || new_id || ':' || u);
        end loop;
        n := n + 1;
      end if;
    end if;
    nxt := tt_next_run(slot, r.frequency, r.interval_n, tz);
    update tt_task_recurrence set next_run = nxt, last_generated_at = now(),
      active = (until_date is null or (nxt at time zone tz)::date <= until_date) where task_id = r.task_id;
  end loop;
  return n;
end $$;
revoke execute on function tt_generate_recurrences(int) from public, anon, authenticated;
grant execute on function tt_generate_recurrences(int) to service_role;

-- same as 0012 without the p_client argument
drop function if exists tt_create_from_template(uuid, text, uuid, uuid, uuid, uuid, date, text[]);
create or replace function tt_create_from_template(
  p_template uuid, p_title text default null, p_department uuid default null, p_assignee uuid default null,
  p_project uuid default null, p_start date default null, p_extra_emails text[] default '{}'
) returns uuid language plpgsql security definer set search_path = public as $$
declare tpl tt_task_templates; v_task uuid; v_sub uuid; s jsonb; who uuid; base date := coalesce(p_start, current_date);
begin
  select * into tpl from tt_task_templates where id = p_template;
  if not found then raise exception 'Template not found'; end if;
  if coalesce(tt_role(tpl.org_id), '') not in ('owner','admin') then raise exception 'Not authorized'; end if;
  who := coalesce(p_assignee, tpl.assignee_id);
  if who is not null and not exists (select 1 from tt_org_members where org_id = tpl.org_id and user_id = who and active) then
    raise exception 'Assignee must be an active member';
  end if;
  if p_department is not null and not exists (select 1 from tt_departments where id = p_department and org_id = tpl.org_id) then
    raise exception 'Department not found';
  end if;

  insert into tt_tasks(org_id, project_id, department_id, title, description, priority, start_date, due_date, notify_emails, created_by)
  values (tpl.org_id, p_project, coalesce(p_department, tpl.department_ids[1]), left(coalesce(nullif(trim(p_title), ''), tpl.title), 200), tpl.description,
          tpl.priority, base, case when tpl.due_offset_days is null then null else (base + tpl.due_offset_days)::timestamptz end,
          (select coalesce(array_agg(distinct x), '{}') from unnest(tpl.notify_emails || coalesce(p_extra_emails, '{}')) x where x ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
          auth.uid())
  returning id into v_task;
  if who is not null then perform tt_assign(v_task, who, true); end if;

  for s in select * from jsonb_array_elements(tpl.subtasks) loop
    insert into tt_tasks(org_id, project_id, department_id, parent_task_id, title, priority, start_date, due_date, created_by)
    values (tpl.org_id, p_project, coalesce(p_department, tpl.department_ids[1]), v_task, left(coalesce(s->>'title', 'Subtask'), 200), tpl.priority,
            base + coalesce((s->>'start_offset_days')::int, 0),
            case when s ? 'due_offset_days' and s->>'due_offset_days' is not null then (base + (s->>'due_offset_days')::int)::timestamptz end, auth.uid())
    returning id into v_sub;
    if coalesce((s->>'assignee_id')::uuid, who) is not null then perform tt_assign(v_sub, coalesce((s->>'assignee_id')::uuid, who), true); end if;
  end loop;

  perform tt_log(tpl.org_id, 'task', v_task, 'created_from_template', jsonb_build_object('template', tpl.name));
  return v_task;
end $$;
revoke all on function tt_create_from_template(uuid, text, uuid, uuid, uuid, date, text[]) from public;
grant execute on function tt_create_from_template(uuid, text, uuid, uuid, uuid, date, text[]) to authenticated;

-- the Platform page's organization list, without the client count
drop function if exists tt_platform_orgs();
create function tt_platform_orgs() returns table(id uuid, name text, time_zone text, created_at timestamptz, members bigint, open_tasks bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not tt_is_platform_admin() then raise exception 'Not authorized'; end if;
  return query select o.id, o.name, o.time_zone, o.created_at,
    (select count(*) from tt_org_members m where m.org_id = o.id and m.active),
    (select count(*) from tt_tasks t where t.org_id = o.id and t.archived_at is null and t.status not in ('completed','completed_cycle'))
  from tt_organizations o order by o.created_at;
end $$;
revoke all on function tt_platform_orgs() from public;
grant execute on function tt_platform_orgs() to authenticated;

-- ───────── client data and columns
delete from tt_files where entity_type = 'client';
-- found by definition, since tables renamed from older un-prefixed names keep their old constraint names
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'tt_files'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%entity_type%' loop
    execute format('alter table tt_files drop constraint %I', c);
  end loop;
end $$;
alter table tt_files add constraint tt_files_entity_type_check check (entity_type in ('task','project'));
alter table tt_files drop column if exists visibility;
alter table tt_task_comments drop column if exists visibility;
delete from tt_notifications where type = 'portal_update';
delete from tt_activity_logs where entity_type = 'client';

alter table tt_tasks drop column if exists client_visible, drop column if exists client_id;
alter table tt_projects drop column if exists client_visible, drop column if exists client_id;
alter table tt_approvals drop column if exists approver_contact_id;

drop table if exists tt_client_notes, tt_client_contacts, tt_clients cascade;
drop function if exists tt_clients_parent_guard();

commit;
