-- REVIEW BEFORE APPLYING. Additive only. Tasks, collaboration, escalations, notifications, files.
-- All state changes that need history go through SECURITY DEFINER functions (tt_*), which re-check
-- membership/role from tt_org_members using auth.uid(); nothing trusts client-supplied roles.

-- ───────── profiles (display names / emails; table is tt_ prefixed to avoid clashing with an existing "profiles")
create table if not exists tt_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now()
);
comment on table tt_profiles is 'Display name/email per auth user. Filled by trigger on auth.users.';

create or replace function tt_handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into tt_profiles(user_id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;
  return new;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tt_on_auth_user_created') then
    create trigger tt_on_auth_user_created after insert on auth.users for each row execute function tt_handle_new_user();
  end if;
end $$;

insert into tt_profiles(user_id, email, full_name)
select id, email, coalesce(raw_user_meta_data->>'full_name', split_part(email, '@', 1)) from auth.users
on conflict (user_id) do nothing;

alter table tt_profiles enable row level security;
create policy profiles_read on tt_profiles for select using (
  user_id = auth.uid() or exists (
    select 1 from tt_org_members a join tt_org_members b on b.org_id = a.org_id
    where a.user_id = auth.uid() and a.active and b.user_id = tt_profiles.user_id));
create policy profiles_update_self on tt_profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ───────── helpers
create or replace function tt_role(p_org uuid) returns text language sql stable security definer set search_path = public as $$
  select role from tt_org_members where org_id = p_org and user_id = auth.uid() and active;
$$;

create or replace function tt_log(p_org uuid, p_type text, p_id uuid, p_action text, p_detail jsonb default '{}') returns void
language sql security definer set search_path = public as $$
  insert into tt_activity_logs(org_id, entity_type, entity_id, action, actor_id, detail) values (p_org, p_type, p_id, p_action, auth.uid(), p_detail);
$$;

-- ───────── task columns
alter table tt_tasks add column if not exists parent_task_id uuid references tt_tasks(id);
alter table tt_tasks add column if not exists start_date timestamptz;
alter table tt_tasks add column if not exists estimated_hours numeric(8,2);
alter table tt_tasks add column if not exists actual_hours numeric(8,2);
alter table tt_tasks add column if not exists tags text[] not null default '{}';
alter table tt_tasks add column if not exists client_visible boolean not null default false;
alter table tt_tasks add column if not exists requires_approval boolean not null default false;
alter table tt_tasks add column if not exists completed_at timestamptz;
alter table tt_tasks add column if not exists completed_by uuid references auth.users(id);
alter table tt_tasks add column if not exists archived_at timestamptz;
alter table tt_tasks add column if not exists recurrence_parent_id uuid references tt_tasks(id);
alter table tt_tasks add column if not exists occurrence_date date;
create unique index if not exists tt_tasks_occurrence on tt_tasks(recurrence_parent_id, occurrence_date);
create index if not exists tt_tasks_due on tt_tasks(org_id, due_date) where status not in ('completed','cancelled');
create index if not exists tt_tasks_project on tt_tasks(project_id);
create index if not exists tt_tasks_client on tt_tasks(client_id);

-- New tasks always start as not_yet_started; status can only change through tt_set_task_status / escalation functions.
create or replace function tt_tasks_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'not_yet_started'; new.completed_at := null; new.completed_by := null;
  elsif new.status is distinct from old.status and coalesce(current_setting('tt.rpc', true), '') <> 'on' then
    raise exception 'Task status can only be changed through the status workflow';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists tt_tasks_guard_trg on tt_tasks;
create trigger tt_tasks_guard_trg before insert or update on tt_tasks for each row execute function tt_tasks_guard();


-- first history row so every task shows "Created -> Not Yet Started"
create or replace function tt_tasks_created() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into tt_task_status_history(org_id, task_id, from_status, to_status, changed_by) values (new.org_id, new.id, null, new.status, new.created_by);
  return null;
end $$;
drop trigger if exists tt_tasks_created_trg on tt_tasks;
create trigger tt_tasks_created_trg after insert on tt_tasks for each row execute function tt_tasks_created();

-- ───────── watchers, checklist, dependencies
create table if not exists tt_task_watchers (
  task_id uuid not null references tt_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  primary key (task_id, user_id)
);
create table if not exists tt_task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tt_organizations(id) on delete cascade,
  task_id uuid not null references tt_tasks(id) on delete cascade,
  title text not null,
  done boolean not null default false,
  done_by uuid references auth.users(id),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists tt_checklist_task on tt_task_checklist_items(task_id, position);
create table if not exists tt_task_dependencies (
  task_id uuid not null references tt_tasks(id) on delete cascade,
  blocked_by_id uuid not null references tt_tasks(id) on delete cascade,
  org_id uuid not null references tt_organizations(id) on delete cascade,
  created_by uuid references auth.users(id),
  primary key (task_id, blocked_by_id),
  check (task_id <> blocked_by_id)
);
comment on table tt_task_dependencies is 'task_id cannot start until blocked_by_id is completed/cancelled. Cycles rejected by tt_add_dependency.';

-- ───────── comments (+ edit audit)
create table if not exists tt_task_comments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tt_organizations(id) on delete cascade,
  task_id uuid not null references tt_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  author_name text,
  body text not null,
  visibility text not null default 'internal' check (visibility in ('internal','client')),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
comment on column tt_task_comments.author_name is 'Copied from tt_profiles by trigger so portal users never need profile access.';
create index if not exists tt_comments_task on tt_task_comments(task_id, created_at);
create table if not exists tt_task_comment_edits (
  id bigserial primary key,
  comment_id uuid not null references tt_task_comments(id) on delete cascade,
  old_body text not null,
  edited_by uuid,
  edited_at timestamptz not null default now()
);

-- ───────── files (metadata; bytes live in private storage bucket tt-files)
create table if not exists tt_files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tt_organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('task','project','client')),
  entity_id uuid not null,
  path text not null unique,
  name text not null,
  mime text,
  size_bytes bigint,
  visibility text not null default 'internal' check (visibility in ('internal','client')),
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists tt_files_entity on tt_files(entity_type, entity_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tt-files', 'tt-files', false, 10485760,
  array['image/png','image/jpeg','image/gif','application/pdf','text/plain','text/csv',
        'application/zip','application/msword','application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

-- ───────── escalations
create table if not exists tt_escalations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tt_organizations(id) on delete cascade,
  task_id uuid not null references tt_tasks(id) on delete cascade,
  reason text not null,
  description text,
  severity text not null check (severity in ('low','medium','high','critical')),
  owner_id uuid references auth.users(id),
  target_date timestamptz,
  state text not null default 'open' check (state in ('open','acknowledged','in_progress','waiting','resolved','closed')),
  previous_task_status text not null,
  raised_by uuid references auth.users(id),
  raised_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  resolution text,
  resolved_task_status text
);
comment on column tt_escalations.previous_task_status is 'Operational task status preserved at the moment of escalation.';
create index if not exists tt_escalations_org_state on tt_escalations(org_id, state);
create index if not exists tt_escalations_task on tt_escalations(task_id);
create table if not exists tt_escalation_updates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tt_organizations(id) on delete cascade,
  escalation_id uuid not null references tt_escalations(id) on delete cascade,
  user_id uuid references auth.users(id),
  state text,
  note text,
  created_at timestamptz not null default now()
);

-- ───────── approvals
create table if not exists tt_approvals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tt_organizations(id) on delete cascade,
  task_id uuid not null references tt_tasks(id) on delete cascade,
  requested_by uuid references auth.users(id),
  approver_user_id uuid references auth.users(id),
  approver_contact_id uuid references tt_client_contacts(id),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  comment text,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tt_approvals_task on tt_approvals(task_id);

-- ───────── notifications
create table if not exists tt_notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tt_organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  dedup_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedup_key)
);
create index if not exists tt_notifications_user on tt_notifications(user_id, read_at, created_at desc);
create table if not exists tt_notification_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references tt_organizations(id) on delete cascade,
  type text not null,
  in_app boolean not null default true,
  email boolean not null default true,
  primary key (user_id, org_id, type)
);
create table if not exists tt_email_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tt_organizations(id) on delete cascade,
  user_id uuid references auth.users(id),
  to_email text not null,
  subject text not null,
  body text,
  dedup_key text,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  attempts int not null default 0,
  last_error text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (user_id, dedup_key)
);
comment on table tt_email_delivery_logs is 'status=sent only after the provider confirms. failed rows are retried by the cron tick up to 5 attempts.';
create index if not exists tt_email_pending on tt_email_delivery_logs(status, attempts, created_at);

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
      insert into tt_email_delivery_logs(org_id, user_id, to_email, subject, body, dedup_key)
      values (p_org, p_user, em, p_title, coalesce(p_body, p_title), p_dedup) on conflict (user_id, dedup_key) do nothing;
    end if;
  end if;
end $$;

create or replace function tt_task_participants(p_task uuid) returns setof uuid language sql stable security definer set search_path = public as $$
  select user_id from tt_task_assignees where task_id = p_task
  union select user_id from tt_task_watchers where task_id = p_task
  union select created_by from tt_tasks where id = p_task and created_by is not null;
$$;

-- ───────── comment triggers: author name, edit audit, notifications
create or replace function tt_comment_before() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    select coalesce(full_name, email) into new.author_name from tt_profiles where user_id = new.user_id;
  elsif new.body is distinct from old.body then
    insert into tt_task_comment_edits(comment_id, old_body, edited_by) values (old.id, old.body, auth.uid());
    new.edited_at := now();
  end if;
  return new;
end $$;
drop trigger if exists tt_comment_before_trg on tt_task_comments;
create trigger tt_comment_before_trg before insert or update on tt_task_comments for each row execute function tt_comment_before();

create or replace function tt_comment_after() returns trigger language plpgsql security definer set search_path = public as $$
declare t record; u uuid;
begin
  select id, title, client_id into t from tt_tasks where id = new.task_id;
  for u in select * from tt_task_participants(new.task_id) loop
    if u <> new.user_id then
      perform tt_notify(new.org_id, u, 'task_comment', 'New comment on ' || t.title, left(new.body, 200), '/tasks/' || t.id, 'comment:' || new.id || ':' || u);
    end if;
  end loop;
  if new.visibility = 'client' and t.client_id is not null then
    for u in select user_id from tt_client_contacts where client_id = t.client_id and user_id is not null and portal_access and status = 'active' loop
      if u <> new.user_id then
        perform tt_notify(new.org_id, u, 'portal_update', 'New update on ' || t.title, left(new.body, 200), '/', 'pcomment:' || new.id || ':' || u);
      end if;
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists tt_comment_after_trg on tt_task_comments;
create trigger tt_comment_after_trg after insert on tt_task_comments for each row execute function tt_comment_after();

-- ───────── workflow functions
create or replace function tt_transition_ok(p_from text, p_to text) returns boolean language sql immutable as $$
  select case p_from
    when 'not_yet_started' then p_to in ('in_progress','blocked','cancelled')
    when 'in_progress'     then p_to in ('in_review','blocked','completed','cancelled','not_yet_started')
    when 'in_review'       then p_to in ('in_progress','completed','blocked','cancelled')
    when 'blocked'         then p_to in ('in_progress','not_yet_started','cancelled')
    when 'completed'       then p_to in ('in_progress')
    when 'cancelled'       then p_to in ('not_yet_started')
    else false end;
$$;

create or replace function tt_set_task_status(p_task uuid, p_to text, p_reason text default null, p_override boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare t tt_tasks; r text; assigned boolean; u uuid;
begin
  select * into t from tt_tasks where id = p_task for update;
  if not found then raise exception 'Task not found'; end if;
  r := tt_role(t.org_id);
  if r is null then raise exception 'Not authorized'; end if;
  assigned := exists (select 1 from tt_task_assignees where task_id = p_task and user_id = auth.uid());
  if r not in ('owner','admin','manager') and not assigned then raise exception 'Only assignees or managers can change status'; end if;
  if p_to = 'escalation' or t.status = 'escalation' then raise exception 'Use the escalation workflow to enter or leave Escalation'; end if;
  if not tt_transition_ok(t.status, p_to) then raise exception 'Invalid status change: % to %', t.status, p_to; end if;
  if p_to = 'in_progress' and exists (
      select 1 from tt_task_dependencies d join tt_tasks b on b.id = d.blocked_by_id
      where d.task_id = p_task and b.status not in ('completed','cancelled')) then
    if not (p_override and r in ('owner','admin','manager')) then
      raise exception 'Cannot start: blocked by incomplete dependencies (a manager can override)';
    end if;
  end if;
  if p_to = 'completed' and t.requires_approval and not exists (select 1 from tt_approvals where task_id = p_task and status = 'approved') then
    raise exception 'Approval required before this task can be completed';
  end if;
  perform set_config('tt.rpc', 'on', true);
  update tt_tasks set status = p_to,
    completed_at = case when p_to = 'completed' then now() else null end,
    completed_by = case when p_to = 'completed' then auth.uid() else null end
  where id = p_task;
  insert into tt_task_status_history(org_id, task_id, from_status, to_status, changed_by, reason) values (t.org_id, p_task, t.status, p_to, auth.uid(), p_reason);
  perform tt_log(t.org_id, 'task', p_task, 'status_changed', jsonb_build_object('from', t.status, 'to', p_to));
  for u in select * from tt_task_participants(p_task) loop
    if u <> auth.uid() then
      perform tt_notify(t.org_id, u, case when p_to = 'in_review' then 'review_requested' else 'task_status' end,
        t.title || ' is now ' || replace(p_to, '_', ' '), p_reason, '/tasks/' || p_task, null);
    end if;
  end loop;
end $$;

create or replace function tt_assign(p_task uuid, p_user uuid, p_add boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare t tt_tasks;
begin
  select * into t from tt_tasks where id = p_task;
  if not found then raise exception 'Task not found'; end if;
  if tt_role(t.org_id) not in ('owner','admin','manager') then raise exception 'Not authorized'; end if;
  if not exists (select 1 from tt_org_members where org_id = t.org_id and user_id = p_user and active) then
    raise exception 'User is not an active member of this organization';
  end if;
  if p_add then
    insert into tt_task_assignees(task_id, user_id, assigned_by) values (p_task, p_user, auth.uid()) on conflict do nothing;
    if p_user <> auth.uid() then perform tt_notify(t.org_id, p_user, 'task_assigned', 'You were assigned: ' || t.title, null, '/tasks/' || p_task, 'assign:' || p_task || ':' || p_user); end if;
  else
    delete from tt_task_assignees where task_id = p_task and user_id = p_user;
    if p_user <> auth.uid() then perform tt_notify(t.org_id, p_user, 'task_assignment_changed', 'You were unassigned from: ' || t.title, null, '/tasks/' || p_task, null); end if;
  end if;
  perform tt_log(t.org_id, 'task', p_task, case when p_add then 'assignee_added' else 'assignee_removed' end, jsonb_build_object('user', p_user));
end $$;

create or replace function tt_add_dependency(p_task uuid, p_blocker uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a tt_tasks; b tt_tasks; cyc boolean;
begin
  select * into a from tt_tasks where id = p_task; select * into b from tt_tasks where id = p_blocker;
  if a.id is null or b.id is null then raise exception 'Task not found'; end if;
  if a.org_id <> b.org_id then raise exception 'Tasks must be in the same organization'; end if;
  if tt_role(a.org_id) not in ('owner','admin','manager') then raise exception 'Not authorized'; end if;
  if p_task = p_blocker then raise exception 'A task cannot depend on itself'; end if;
  with recursive up as (
    select blocked_by_id as id from tt_task_dependencies where task_id = p_blocker
    union select d.blocked_by_id from tt_task_dependencies d join up on d.task_id = up.id)
  select exists (select 1 from up where id = p_task) into cyc;
  if cyc then raise exception 'This dependency would create a circular chain'; end if;
  insert into tt_task_dependencies(task_id, blocked_by_id, org_id, created_by) values (p_task, p_blocker, a.org_id, auth.uid()) on conflict do nothing;
  perform tt_log(a.org_id, 'task', p_task, 'dependency_added', jsonb_build_object('blocked_by', p_blocker));
end $$;

create or replace function tt_raise_escalation(p_task uuid, p_reason text, p_description text, p_severity text, p_owner uuid default null, p_target timestamptz default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare t tt_tasks; esc uuid; u uuid;
begin
  select * into t from tt_tasks where id = p_task for update;
  if not found then raise exception 'Task not found'; end if;
  if tt_role(t.org_id) is null then raise exception 'Not authorized'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  if t.status in ('escalation','completed','cancelled') then raise exception 'Task cannot be escalated from status %', t.status; end if;
  if p_owner is not null and not exists (select 1 from tt_org_members where org_id = t.org_id and user_id = p_owner and active) then
    raise exception 'Escalation owner must be an active member';
  end if;
  insert into tt_escalations(org_id, task_id, reason, description, severity, owner_id, target_date, previous_task_status, raised_by)
  values (t.org_id, p_task, trim(p_reason), p_description, p_severity, p_owner, p_target, t.status, auth.uid()) returning id into esc;
  insert into tt_escalation_updates(org_id, escalation_id, user_id, state, note) values (t.org_id, esc, auth.uid(), 'open', 'Escalation raised: ' || trim(p_reason));
  perform set_config('tt.rpc', 'on', true);
  update tt_tasks set status = 'escalation' where id = p_task;
  insert into tt_task_status_history(org_id, task_id, from_status, to_status, changed_by, reason) values (t.org_id, p_task, t.status, 'escalation', auth.uid(), p_reason);
  perform tt_log(t.org_id, 'task', p_task, 'escalation_raised', jsonb_build_object('escalation', esc, 'severity', p_severity));
  for u in select user_id from tt_org_members where org_id = t.org_id and active
      and ((p_owner is not null and user_id = p_owner) or (p_owner is null and role in ('owner','admin','manager'))) loop
    if u <> auth.uid() then
      perform tt_notify(t.org_id, u, 'escalation_raised', 'Escalation (' || p_severity || '): ' || t.title, p_reason, '/escalations', null);
    end if;
  end loop;
  return esc;
end $$;

create or replace function tt_escalation_update(p_esc uuid, p_state text, p_note text, p_owner uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare e tt_escalations; r text;
begin
  select * into e from tt_escalations where id = p_esc for update;
  if not found then raise exception 'Escalation not found'; end if;
  r := tt_role(e.org_id);
  if r is null or (r not in ('owner','admin','manager') and e.owner_id is distinct from auth.uid()) then raise exception 'Not authorized'; end if;
  if p_state not in ('open','acknowledged','in_progress','waiting','closed') then raise exception 'Invalid state (use resolve to resolve)'; end if;
  if e.state in ('resolved','closed') and p_state <> 'closed' then raise exception 'Escalation is already resolved'; end if;
  if p_state = 'closed' and e.state <> 'resolved' then raise exception 'Only a resolved escalation can be closed'; end if;
  if p_owner is not null and not exists (select 1 from tt_org_members where org_id = e.org_id and user_id = p_owner and active) then
    raise exception 'Owner must be an active member';
  end if;
  update tt_escalations set state = p_state,
    owner_id = coalesce(p_owner, owner_id),
    acknowledged_at = case when p_state = 'acknowledged' and acknowledged_at is null then now() else acknowledged_at end
  where id = p_esc;
  insert into tt_escalation_updates(org_id, escalation_id, user_id, state, note) values (e.org_id, p_esc, auth.uid(), p_state, p_note);
  if p_owner is not null and p_owner is distinct from e.owner_id and p_owner <> auth.uid() then
    perform tt_notify(e.org_id, p_owner, 'escalation_reassigned', 'You now own an escalation', p_note, '/escalations', null);
  end if;
  perform tt_log(e.org_id, 'task', e.task_id, 'escalation_updated', jsonb_build_object('state', p_state));
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
  if p_next_status is null or p_next_status not in ('not_yet_started','in_progress','in_review','blocked','completed','cancelled') then
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

create or replace function tt_request_approval(p_task uuid, p_user uuid default null, p_contact uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare t tt_tasks; new_id uuid; u uuid;
begin
  select * into t from tt_tasks where id = p_task;
  if not found then raise exception 'Task not found'; end if;
  if tt_role(t.org_id) not in ('owner','admin','manager') then raise exception 'Not authorized'; end if;
  if p_user is null and p_contact is null then raise exception 'Choose an approver'; end if;
  if p_contact is not null and not exists (select 1 from tt_client_contacts where id = p_contact and client_id = t.client_id and can_approve and portal_access) then
    raise exception 'Contact cannot approve for this client';
  end if;
  insert into tt_approvals(org_id, task_id, requested_by, approver_user_id, approver_contact_id) values (t.org_id, p_task, auth.uid(), p_user, p_contact) returning tt_approvals.id into new_id;
  for u in select coalesce(p_user, (select user_id from tt_client_contacts where id = p_contact)) loop
    if u is not null then perform tt_notify(t.org_id, u, 'approval_requested', 'Approval requested: ' || t.title, null, case when p_contact is not null then '/' else '/tasks/' || p_task end, 'appr:' || new_id); end if;
  end loop;
  perform tt_log(t.org_id, 'task', p_task, 'approval_requested', '{}');
  return new_id;
end $$;

create or replace function tt_decide_approval(p_id uuid, p_approve boolean, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a tt_approvals; ok boolean;
begin
  select * into a from tt_approvals where id = p_id for update;
  if not found then raise exception 'Approval not found'; end if;
  if a.status <> 'pending' then raise exception 'Already decided'; end if;
  ok := a.approver_user_id = auth.uid()
     or exists (select 1 from tt_client_contacts c where c.id = a.approver_contact_id and c.user_id = auth.uid() and c.can_approve and c.portal_access and c.status = 'active');
  if not ok then raise exception 'Not authorized'; end if;
  update tt_approvals set status = case when p_approve then 'approved' else 'rejected' end, comment = p_comment, decided_by = auth.uid(), decided_at = now() where id = p_id;
  perform tt_log(a.org_id, 'task', a.task_id, case when p_approve then 'approval_approved' else 'approval_rejected' end, '{}');
  if a.requested_by is not null and a.requested_by <> auth.uid() then
    perform tt_notify(a.org_id, a.requested_by, 'approval_completed', 'Approval ' || case when p_approve then 'granted' else 'rejected' end, p_comment, '/tasks/' || a.task_id, null);
  end if;
end $$;

-- ───────── RLS
alter table tt_task_watchers enable row level security;
alter table tt_task_checklist_items enable row level security;
alter table tt_task_dependencies enable row level security;
alter table tt_task_comments enable row level security;
alter table tt_task_comment_edits enable row level security;
alter table tt_files enable row level security;
alter table tt_escalations enable row level security;
alter table tt_escalation_updates enable row level security;
alter table tt_approvals enable row level security;
alter table tt_notifications enable row level security;
alter table tt_notification_preferences enable row level security;
alter table tt_email_delivery_logs enable row level security;

create policy watchers_read on tt_task_watchers for select using (exists (select 1 from tt_tasks t where t.id = task_id and tt_is_org_member(t.org_id)));
create policy watchers_self on tt_task_watchers for all
  using (user_id = auth.uid() or exists (select 1 from tt_tasks t where t.id = task_id and tt_is_org_member(t.org_id, array['owner','admin','manager'])))
  with check (exists (select 1 from tt_tasks t where t.id = task_id and tt_is_org_member(t.org_id)) and
    (user_id = auth.uid() or exists (select 1 from tt_tasks t where t.id = task_id and tt_is_org_member(t.org_id, array['owner','admin','manager']))));

create policy checklist_read on tt_task_checklist_items for select using (tt_is_org_member(org_id));
create policy checklist_write on tt_task_checklist_items for all using (tt_is_org_member(org_id)) with check (tt_is_org_member(org_id));

create policy deps_read on tt_task_dependencies for select using (tt_is_org_member(org_id));
create policy deps_delete on tt_task_dependencies for delete using (tt_is_org_member(org_id, array['owner','admin','manager']));

create policy comments_read on tt_task_comments for select using (tt_is_org_member(org_id));
create policy comments_insert on tt_task_comments for insert with check (tt_is_org_member(org_id) and user_id = auth.uid());
create policy comments_update on tt_task_comments for update
  using (user_id = auth.uid() or tt_is_org_member(org_id, array['owner','admin','manager']));
create policy comment_edits_read on tt_task_comment_edits for select
  using (exists (select 1 from tt_task_comments c where c.id = comment_id and tt_is_org_member(c.org_id, array['owner','admin','manager'])));

create policy files_read on tt_files for select using (tt_is_org_member(org_id));
create policy files_insert on tt_files for insert with check (tt_is_org_member(org_id) and uploaded_by = auth.uid());
create policy files_delete on tt_files for delete using (uploaded_by = auth.uid() or tt_is_org_member(org_id, array['owner','admin','manager']));

create policy esc_read on tt_escalations for select using (tt_is_org_member(org_id));
create policy escu_read on tt_escalation_updates for select using (tt_is_org_member(org_id));
create policy appr_read on tt_approvals for select using (tt_is_org_member(org_id));

create policy notif_own on tt_notifications for select using (user_id = auth.uid());
create policy notif_update on tt_notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy prefs_own on tt_notification_preferences for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy email_logs_admin on tt_email_delivery_logs for select using (tt_is_org_member(org_id, array['owner','admin']));

-- storage: members of the org named by the first path segment
create policy tt_files_member_read on storage.objects for select
  using (bucket_id = 'tt-files' and tt_is_org_member(((storage.foldername(name))[1])::uuid));
create policy tt_files_member_insert on storage.objects for insert
  with check (bucket_id = 'tt-files' and tt_is_org_member(((storage.foldername(name))[1])::uuid));
create policy tt_files_member_delete on storage.objects for delete
  using (bucket_id = 'tt-files' and (owner = auth.uid() or tt_is_org_member(((storage.foldername(name))[1])::uuid, array['owner','admin','manager'])));
