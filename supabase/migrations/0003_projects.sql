-- REVIEW BEFORE APPLYING. Additive only. Projects: extra fields, members, milestones.

alter table projects add column if not exists description text;
alter table projects add column if not exists priority text not null default 'medium'
  check (priority in ('low','medium','high','urgent'));
alter table projects add column if not exists start_date date;
alter table projects add column if not exists due_date date;
alter table projects add column if not exists manager_id uuid references auth.users(id);
-- progress_mode decides how progress is shown: typed by hand, or calculated from milestones / tasks
alter table projects add column if not exists progress_mode text not null default 'milestones'
  check (progress_mode in ('manual','milestones','tasks'));
alter table projects add column if not exists manual_progress int not null default 0
  check (manual_progress between 0 and 100);
alter table projects add column if not exists updated_at timestamptz not null default now();

create table if not exists tt_project_members (
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
comment on table tt_project_members is 'Team members on a project. UI arrives with the employee directory (Phase 7).';

create table if not exists tt_project_milestones (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table tt_project_milestones is 'Project checkpoints; completed_at null = open. Drives calculated progress.';
create index if not exists tt_milestones_project on tt_project_milestones(project_id);

alter table tt_project_members enable row level security;
alter table tt_project_milestones enable row level security;

create policy pmembers_read on tt_project_members for select
  using (exists (select 1 from projects p where p.id = project_id and is_org_member(p.org_id)));
create policy pmembers_write on tt_project_members for all
  using (exists (select 1 from projects p where p.id = project_id and is_org_member(p.org_id, array['owner','admin','manager'])))
  with check (exists (select 1 from projects p where p.id = project_id and is_org_member(p.org_id, array['owner','admin','manager'])));

create policy milestones_read on tt_project_milestones for select using (is_org_member(org_id));
create policy milestones_write on tt_project_milestones for all
  using (is_org_member(org_id, array['owner','admin','manager']))
  with check (is_org_member(org_id, array['owner','admin','manager']));
