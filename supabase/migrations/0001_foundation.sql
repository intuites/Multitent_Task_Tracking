-- REVIEW BEFORE APPLYING. Additive only. Tenant core: tt_organizations, members, tt_clients, tt_projects, tasks.

create table if not exists tt_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  time_zone text not null default 'UTC',
  created_at timestamptz not null default now()
);
comment on table tt_organizations is 'Tenant root. Every tenant-owned row carries org_id.';

create table if not exists tt_org_members (
  org_id uuid not null references tt_organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','manager','employee')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
comment on table tt_org_members is 'Source of truth for a user role in an org; used by RLS and the API.';

create table if not exists tt_clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tt_organizations(id) on delete cascade,
  type text not null check (type in ('individual','business')),
  name text not null,
  email text,
  phone text,
  status text not null default 'lead' check (status in ('lead','prospect','active','on_hold','inactive','archived')),
  owner_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clients_org_status on tt_clients(org_id, status);

create table if not exists tt_projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tt_organizations(id) on delete cascade,
  client_id uuid references tt_clients(id),
  name text not null,
  status text not null default 'planning' check (status in
    ('planning','not_started','in_progress','on_hold','in_review','completed','cancelled','archived')),
  client_visible boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists projects_org on tt_projects(org_id);

create table if not exists tt_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tt_organizations(id) on delete cascade,
  client_id uuid references tt_clients(id),
  project_id uuid references tt_projects(id),
  title text not null,
  description text,
  status text not null default 'not_yet_started' check (status in
    ('not_yet_started','in_progress','in_review','blocked','escalation','completed','cancelled')),
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  due_date timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tt_tasks_org_status on tt_tasks(org_id, status);

create table if not exists tt_task_assignees (
  task_id uuid not null references tt_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  assigned_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create table if not exists tt_task_status_history (
  id bigserial primary key,
  org_id uuid not null references tt_organizations(id) on delete cascade,
  task_id uuid not null references tt_tasks(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid references auth.users(id),
  reason text,
  changed_at timestamptz not null default now()
);

-- RLS helper: caller is an active member, optionally with one of the given roles.
create or replace function tt_is_org_member(p_org uuid, p_roles text[] default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from tt_org_members m
    where m.org_id = p_org and m.user_id = auth.uid() and m.active
      and (p_roles is null or m.role = any(p_roles)));
$$;

alter table tt_organizations enable row level security;
alter table tt_org_members enable row level security;
alter table tt_clients enable row level security;
alter table tt_projects enable row level security;
alter table tt_tasks enable row level security;
alter table tt_task_assignees enable row level security;
alter table tt_task_status_history enable row level security;

create policy org_read on tt_organizations for select using (tt_is_org_member(id));
create policy members_read on tt_org_members for select using (tt_is_org_member(org_id));
create policy members_write on tt_org_members for all
  using (tt_is_org_member(org_id, array['owner','admin'])) with check (tt_is_org_member(org_id, array['owner','admin']));

create policy clients_read on tt_clients for select using (tt_is_org_member(org_id));
create policy clients_write on tt_clients for all
  using (tt_is_org_member(org_id, array['owner','admin','manager']))
  with check (tt_is_org_member(org_id, array['owner','admin','manager']));

create policy projects_read on tt_projects for select using (tt_is_org_member(org_id));
create policy projects_write on tt_projects for all
  using (tt_is_org_member(org_id, array['owner','admin','manager']))
  with check (tt_is_org_member(org_id, array['owner','admin','manager']));

create policy tasks_read on tt_tasks for select using (tt_is_org_member(org_id));
create policy tasks_write on tt_tasks for all
  using (tt_is_org_member(org_id, array['owner','admin','manager']))
  with check (tt_is_org_member(org_id, array['owner','admin','manager']));

create policy assignees_read on tt_task_assignees for select
  using (exists (select 1 from tt_tasks t where t.id = task_id and tt_is_org_member(t.org_id)));
create policy assignees_write on tt_task_assignees for all
  using (exists (select 1 from tt_tasks t where t.id = task_id and tt_is_org_member(t.org_id, array['owner','admin','manager'])))
  with check (exists (select 1 from tt_tasks t where t.id = task_id and tt_is_org_member(t.org_id, array['owner','admin','manager'])));

create policy history_read on tt_task_status_history for select using (tt_is_org_member(org_id));
-- History rows are written only by the server (service role); no client insert policy.
