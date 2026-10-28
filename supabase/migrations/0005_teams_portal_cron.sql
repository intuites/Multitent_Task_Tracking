-- REVIEW BEFORE APPLYING. Additive only. Teams, org onboarding, recurrence, reminders, client portal, platform admin.

-- ───────── org onboarding / settings / membership guard
create or replace function tt_create_organization(p_name text, p_slug text, p_tz text default 'UTC') returns uuid
language plpgsql security definer set search_path = public as $$
declare oid uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Organization name is required'; end if;
  if p_slug !~ '^[a-z0-9][a-z0-9-]{1,40}$' then raise exception 'Slug must be 2-41 chars: lowercase letters, digits, hyphens'; end if;
  if not exists (select 1 from pg_timezone_names where name = p_tz) then raise exception 'Unknown time zone'; end if;
  insert into organizations(name, slug, time_zone) values (trim(p_name), p_slug, p_tz) returning id into oid;
  perform set_config('tt.rpc', 'on', true);
  insert into org_members(org_id, user_id, role) values (oid, auth.uid(), 'owner');
  perform tt_log(oid, 'organization', oid, 'created', '{}');
  return oid;
end $$;

create policy org_update on organizations for update
  using (is_org_member(id, array['owner','admin'])) with check (is_org_member(id, array['owner','admin']));

-- Only an owner may grant, change or remove the owner role. Service role (auth.uid() null) is trusted.
create or replace function tt_members_guard() returns trigger language plpgsql as $$
begin
  if auth.uid() is null or coalesce(current_setting('tt.rpc', true), '') = 'on' then return coalesce(new, old); end if;
  if (tg_op <> 'DELETE' and new.role = 'owner') or (tg_op <> 'INSERT' and old.role = 'owner') then
    if tt_role(coalesce(new.org_id, old.org_id)) is distinct from 'owner' then raise exception 'Only an owner can change owner memberships'; end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists tt_members_guard_trg on org_members;
create trigger tt_members_guard_trg before insert or update or delete on org_members for each row execute function tt_members_guard();

-- ───────── departments / teams
create table if not exists tt_departments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);
create table if not exists tt_teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  department_id uuid references tt_departments(id) on delete set null,
  name text not null,
  manager_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (org_id, name)
);
create table if not exists tt_team_members (
  team_id uuid not null references tt_teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (team_id, user_id)
);
alter table tt_departments enable row level security;
alter table tt_teams enable row level security;
alter table tt_team_members enable row level security;
create policy dept_read on tt_departments for select using (is_org_member(org_id));
create policy dept_write on tt_departments for all using (is_org_member(org_id, array['owner','admin'])) with check (is_org_member(org_id, array['owner','admin']));
create policy teams_read on tt_teams for select using (is_org_member(org_id));
create policy teams_write on tt_teams for all using (is_org_member(org_id, array['owner','admin','manager'])) with check (is_org_member(org_id, array['owner','admin','manager']));
create policy tmembers_read on tt_team_members for select using (exists (select 1 from tt_teams t where t.id = team_id and is_org_member(t.org_id)));
create policy tmembers_write on tt_team_members for all
  using (exists (select 1 from tt_teams t where t.id = team_id and is_org_member(t.org_id, array['owner','admin','manager'])))
  with check (exists (select 1 from tt_teams t where t.id = team_id and is_org_member(t.org_id, array['owner','admin','manager'])
    and exists (select 1 from org_members m where m.org_id = t.org_id and m.user_id = tt_team_members.user_id and m.active)));

-- ───────── recurrence
create table if not exists tt_task_recurrence (
  task_id uuid primary key references tt_tasks(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  frequency text not null check (frequency in ('daily','weekly','monthly','custom')),
  interval_n int not null default 1 check (interval_n between 1 and 365),
  next_run timestamptz not null,
  until_date date,
  active boolean not null default true,
  last_generated_at timestamptz
);
comment on table tt_task_recurrence is 'Template task + rule. custom = every interval_n days. Missed slots are collapsed: only the latest due occurrence is created per run.';
create index if not exists tt_recurrence_due on tt_task_recurrence(next_run) where active;
alter table tt_task_recurrence enable row level security;
create policy recur_read on tt_task_recurrence for select using (is_org_member(org_id));
create policy recur_write on tt_task_recurrence for all using (is_org_member(org_id, array['owner','admin','manager'])) with check (is_org_member(org_id, array['owner','admin','manager']));

create or replace function tt_next_run(p_ts timestamptz, p_freq text, p_n int, p_tz text) returns timestamptz language sql immutable as $$
  select ((p_ts at time zone p_tz) + case p_freq
    when 'weekly' then make_interval(weeks => p_n)
    when 'monthly' then make_interval(months => p_n)
    else make_interval(days => p_n) end) at time zone p_tz;
$$;

create or replace function tt_set_recurrence(p_task uuid, p_freq text, p_n int, p_until date default null) returns void
language plpgsql security definer set search_path = public as $$
declare t tt_tasks; tz text;
begin
  select * into t from tt_tasks where id = p_task;
  if not found then raise exception 'Task not found'; end if;
  if tt_role(t.org_id) not in ('owner','admin','manager') then raise exception 'Not authorized'; end if;
  if p_freq is null then delete from tt_task_recurrence where task_id = p_task; return; end if;
  select time_zone into tz from organizations where id = t.org_id;
  insert into tt_task_recurrence(task_id, org_id, frequency, interval_n, next_run, until_date)
  values (p_task, t.org_id, p_freq, p_n, tt_next_run(coalesce(t.due_date, now()), p_freq, p_n, tz), p_until)
  on conflict (task_id) do update set frequency = excluded.frequency, interval_n = excluded.interval_n, until_date = excluded.until_date, active = true;
  perform tt_log(t.org_id, 'task', p_task, 'recurrence_set', jsonb_build_object('frequency', p_freq, 'every', p_n));
end $$;

-- Cron-only: creates the latest due occurrence per rule. Idempotent via unique (recurrence_parent_id, occurrence_date).
create or replace function tt_generate_recurrences(p_limit int default 100) returns int
language plpgsql security definer set search_path = public as $$
declare r record; tz text; slot timestamptz; nxt timestamptz; occ date; new_id uuid; n int := 0; u uuid;
begin
  for r in select * from tt_task_recurrence where active and next_run <= now() order by next_run limit p_limit for update skip locked loop
    select time_zone into tz from organizations where id = r.org_id;
    slot := r.next_run;
    loop
      nxt := tt_next_run(slot, r.frequency, r.interval_n, tz);
      exit when nxt > now();
      slot := nxt;
    end loop;
    occ := (slot at time zone tz)::date;
    if r.until_date is null or occ <= r.until_date then
      new_id := null;
      insert into tt_tasks(org_id, client_id, project_id, title, description, priority, tags, client_visible, requires_approval, estimated_hours, created_by, due_date, recurrence_parent_id, occurrence_date)
      select org_id, client_id, project_id, title, description, priority, tags, client_visible, requires_approval, estimated_hours, created_by, slot, r.task_id, occ
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

-- Cron-only: deadline/overdue/escalation-target reminders, deduplicated per user per local day.
create or replace function tt_generate_reminders(p_limit int default 500) returns int
language plpgsql security definer set search_path = public as $$
declare r record; today date; dl date; n int := 0;
begin
  for r in
    select t.id, t.org_id, t.title, t.due_date, a.user_id, o.time_zone as tz
    from tt_tasks t join tt_task_assignees a on a.task_id = t.id join organizations o on o.id = t.org_id
    where t.status not in ('completed','cancelled') and t.archived_at is null and t.due_date is not null and t.due_date < now() + interval '24 hours'
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

revoke execute on function tt_generate_recurrences(int) from public, anon, authenticated;
revoke execute on function tt_generate_reminders(int) from public, anon, authenticated;
grant execute on function tt_generate_recurrences(int) to service_role;
grant execute on function tt_generate_reminders(int) to service_role;
-- tt_notify must not be callable by end users (it would let them spam others)
revoke execute on function tt_notify(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function tt_log(uuid, text, uuid, text, jsonb) from public, anon, authenticated;

-- ───────── client portal
alter table client_contacts add column if not exists user_id uuid references auth.users(id);
create unique index if not exists client_contacts_user on client_contacts(client_id, user_id) where user_id is not null;

create or replace function tt_portal_client_ids() returns setof uuid language sql stable security definer set search_path = public as $$
  select client_id from client_contacts where user_id = auth.uid() and portal_access and status = 'active';
$$;

create or replace function tt_portal_task_visible(p_task uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from tt_tasks where id = p_task and client_visible and client_id in (select tt_portal_client_ids()));
$$;
create or replace function tt_portal_project_visible(p_project uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from projects where id = p_project and client_visible and client_id in (select tt_portal_client_ids()));
$$;

create policy portal_clients on clients for select using (id in (select tt_portal_client_ids()));
create policy portal_contact_self on client_contacts for select using (user_id = auth.uid() and portal_access);
create policy portal_projects on projects for select using (client_visible and client_id in (select tt_portal_client_ids()));
create policy portal_milestones on tt_project_milestones for select using (tt_portal_project_visible(project_id));
create policy portal_tasks on tt_tasks for select using (client_visible and client_id in (select tt_portal_client_ids()));
create policy portal_comments_read on tt_task_comments for select using (visibility = 'client' and tt_portal_task_visible(task_id));
create policy portal_comments_insert on tt_task_comments for insert
  with check (user_id = auth.uid() and visibility = 'client' and tt_portal_task_visible(task_id));
create policy portal_files_read on tt_files for select using (
  visibility = 'client' and (
    (entity_type = 'task' and tt_portal_task_visible(entity_id)) or
    (entity_type = 'project' and tt_portal_project_visible(entity_id)) or
    (entity_type = 'client' and entity_id in (select tt_portal_client_ids()))));
create policy portal_files_insert on tt_files for insert with check (
  uploaded_by = auth.uid() and visibility = 'client' and (
    (entity_type = 'task' and tt_portal_task_visible(entity_id)) or
    (entity_type = 'project' and tt_portal_project_visible(entity_id))));
create policy portal_approvals_read on tt_approvals for select using (
  approver_contact_id in (select id from client_contacts where user_id = auth.uid()));
-- portal storage: readable iff the caller can see the matching tt_files row (RLS applies inside this subquery)
create policy tt_files_portal_read on storage.objects for select
  using (bucket_id = 'tt-files' and exists (select 1 from tt_files f where f.path = objects.name));
create policy tt_files_portal_insert on storage.objects for insert
  with check (bucket_id = 'tt-files' and ((storage.foldername(name))[1])::uuid in
    (select c.org_id from clients c where c.id in (select tt_portal_client_ids())));

create or replace function tt_portal_submit_request(p_client uuid, p_title text, p_description text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c clients; new_id uuid; u uuid;
begin
  if p_client not in (select tt_portal_client_ids()) then raise exception 'Not authorized'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Title is required'; end if;
  select * into c from clients where id = p_client;
  insert into tt_tasks(org_id, client_id, title, description, client_visible, created_by)
  values (c.org_id, p_client, left(trim(p_title), 200), p_description, true, auth.uid()) returning id into new_id;
  perform tt_log(c.org_id, 'client', p_client, 'portal_request_submitted', jsonb_build_object('task', new_id));
  for u in select user_id from org_members where org_id = c.org_id and active and role in ('owner','admin','manager') loop
    perform tt_notify(c.org_id, u, 'portal_update', 'New client request: ' || left(trim(p_title), 100), null, '/tasks/' || new_id, 'req:' || new_id || ':' || u);
  end loop;
  return new_id;
end $$;

create or replace function tt_portal_update_contact(p_phone text, p_job_title text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update client_contacts set phone = p_phone, job_title = p_job_title where user_id = auth.uid() and portal_access;
end $$;

-- ───────── platform admin
create table if not exists tt_platform_admins (user_id uuid primary key references auth.users(id) on delete cascade);
alter table tt_platform_admins enable row level security; -- no policies: managed with the service role only

create or replace function tt_is_platform_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from tt_platform_admins where user_id = auth.uid());
$$;
create or replace function tt_platform_stats() returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not tt_is_platform_admin() then raise exception 'Not authorized'; end if;
  return jsonb_build_object(
    'organizations', (select count(*) from organizations),
    'active_organizations', (select count(distinct org_id) from org_members where active),
    'members', (select count(*) from org_members where active),
    'open_tasks', (select count(*) from tt_tasks where status not in ('completed','cancelled')),
    'failed_emails', (select count(*) from tt_email_delivery_logs where status = 'failed'),
    'pending_emails', (select count(*) from tt_email_delivery_logs where status = 'pending'));
end $$;
