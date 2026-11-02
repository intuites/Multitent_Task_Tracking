-- REVIEW BEFORE APPLYING. Run after 0018. Additive only: nothing is dropped.
-- Simplified flow: organization -> departments -> department members -> assign the task.
-- Teams, projects, clients, contacts and escalations are no longer used by the app; their tables and data are kept untouched.

create table if not exists tt_department_members (
  department_id uuid not null references tt_departments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references tt_organizations(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (department_id, user_id)
);
create index if not exists tt_department_members_org on tt_department_members(org_id, user_id);

-- the row's org must be the department's org, so nobody can file a person under another tenant's department
create or replace function tt_department_members_guard() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from tt_departments where id = new.department_id and org_id = new.org_id) then
    raise exception 'Department does not belong to this organization';
  end if;
  if not exists (select 1 from tt_org_members where org_id = new.org_id and user_id = new.user_id) then
    raise exception 'That person is not a member of this organization';
  end if;
  return new;
end $$;
drop trigger if exists tt_department_members_guard_trg on tt_department_members;
create trigger tt_department_members_guard_trg before insert or update on tt_department_members for each row execute function tt_department_members_guard();

alter table tt_department_members enable row level security;
drop policy if exists dept_members_read on tt_department_members;
drop policy if exists dept_members_write on tt_department_members;
create policy dept_members_read on tt_department_members for select to authenticated using (tt_is_org_member(org_id));
create policy dept_members_write on tt_department_members for all to authenticated
  using (tt_is_org_member(org_id, array['owner','admin'])) with check (tt_is_org_member(org_id, array['owner','admin']));
grant select, insert, update, delete on tt_department_members to authenticated;

-- carry over: everyone who was in a team that belonged to a department becomes a member of that department
insert into tt_department_members(department_id, user_id, org_id)
select distinct t.department_id, m.user_id, t.org_id
from tt_team_members m join tt_teams t on t.id = m.team_id
join tt_org_members om on om.org_id = t.org_id and om.user_id = m.user_id
where t.department_id is not null
on conflict do nothing;
