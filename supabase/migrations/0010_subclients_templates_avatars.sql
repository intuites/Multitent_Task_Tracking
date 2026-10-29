-- REVIEW BEFORE APPLYING. Additive only: sub-clients, task departments, task templates with subtasks, profile photos.

-- ───────── sub-clients: a client can sit under a parent client in the same organization
alter table tt_clients add column if not exists parent_client_id uuid references tt_clients(id) on delete set null;
create index if not exists tt_clients_parent on tt_clients(parent_client_id);
create or replace function tt_clients_parent_guard() returns trigger language plpgsql as $$
declare cur uuid := new.parent_client_id; depth int := 0;
begin
  if cur is null then return new; end if;
  if cur = new.id then raise exception 'A client cannot be its own parent'; end if;
  if not exists (select 1 from tt_clients where id = cur and org_id = new.org_id) then raise exception 'Parent client must be in the same organization'; end if;
  -- walk up the chain so A → B → A loops are rejected
  while cur is not null and depth < 50 loop
    select parent_client_id into cur from tt_clients where id = cur;
    if cur = new.id then raise exception 'That would make a loop of parent clients'; end if;
    depth := depth + 1;
  end loop;
  return new;
end $$;
drop trigger if exists tt_clients_parent_guard_trg on tt_clients;
create trigger tt_clients_parent_guard_trg before insert or update of parent_client_id on tt_clients for each row execute function tt_clients_parent_guard();

-- ───────── tasks: department, extra people to notify, subtasks (parent_task_id already exists)
alter table tt_tasks add column if not exists department_id uuid references tt_departments(id) on delete set null;
alter table tt_tasks add column if not exists notify_emails text[] not null default '{}';
create index if not exists tt_tasks_parent on tt_tasks(parent_task_id);
create index if not exists tt_tasks_department on tt_tasks(org_id, department_id);

-- ───────── task templates
create table if not exists tt_task_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tt_organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  title text not null check (char_length(title) between 1 and 200),
  description text,
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  department_ids uuid[] not null default '{}',
  assignee_id uuid references auth.users(id) on delete set null,
  notify_emails text[] not null default '{}',
  -- [{ "title": text, "assignee_id": uuid|null, "start_offset_days": int, "due_offset_days": int }]
  subtasks jsonb not null default '[]' check (jsonb_typeof(subtasks) = 'array'),
  due_offset_days int check (due_offset_days between 0 and 3650),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);
alter table tt_task_templates enable row level security;
create policy templates_read on tt_task_templates for select using (tt_is_org_member(org_id));
create policy templates_write on tt_task_templates for all
  using (tt_is_org_member(org_id, array['owner','admin','manager']))
  with check (tt_is_org_member(org_id, array['owner','admin','manager']));

-- Create a task (and its subtasks) from a template in one transaction.
-- The assignee's team manager ("lead") is notified first; extra emails are queued for the email job.
create or replace function tt_create_from_template(
  p_template uuid, p_title text default null, p_department uuid default null, p_assignee uuid default null,
  p_client uuid default null, p_project uuid default null, p_start date default null, p_extra_emails text[] default '{}'
) returns uuid language plpgsql security definer set search_path = public as $$
declare tpl tt_task_templates; v_task uuid; v_sub uuid; s jsonb; who uuid; lead uuid; e text; base date := coalesce(p_start, current_date);
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

  -- primary contact: the manager of each team the assignee belongs to
  if who is not null then
    for lead in select distinct t.manager_id from tt_team_members m join tt_teams t on t.id = m.team_id
                where m.user_id = who and t.org_id = tpl.org_id and t.manager_id is not null and t.manager_id <> who loop
      perform tt_notify(tpl.org_id, lead, 'task_assigned', 'Your team member was assigned: ' || coalesce(nullif(trim(p_title), ''), tpl.title), null, '/tasks/' || v_task, 'lead:' || v_task || ':' || lead);
    end loop;
  end if;
  for e in select unnest(notify_emails) from tt_tasks where id = v_task loop
    insert into tt_email_delivery_logs(org_id, to_email, subject, body, dedup_key)
    values (tpl.org_id, e, 'New task: ' || coalesce(nullif(trim(p_title), ''), tpl.title), coalesce(tpl.description, ''), 'tpl:' || v_task || ':' || e);
  end loop;
  perform tt_log(tpl.org_id, 'task', v_task, 'created_from_template', jsonb_build_object('template', tpl.name));
  return v_task;
end $$;
revoke all on function tt_create_from_template(uuid, text, uuid, uuid, uuid, uuid, date, text[]) from public;
grant execute on function tt_create_from_template(uuid, text, uuid, uuid, uuid, uuid, date, text[]) to authenticated;

-- ───────── profile photos: public bucket, each user writes only inside a folder named after their user id
alter table tt_profiles add column if not exists avatar_url text;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tt-avatars', 'tt-avatars', true, 2097152, array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do nothing;
drop policy if exists tt_avatars_read on storage.objects;
drop policy if exists tt_avatars_write on storage.objects;
drop policy if exists tt_avatars_update on storage.objects;
drop policy if exists tt_avatars_delete on storage.objects;
create policy tt_avatars_read on storage.objects for select using (bucket_id = 'tt-avatars');
create policy tt_avatars_write on storage.objects for insert to authenticated
  with check (bucket_id = 'tt-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy tt_avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'tt-avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'tt-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy tt_avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'tt-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
