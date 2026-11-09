-- REVIEW BEFORE APPLYING. Run after 0041. Safe to run more than once.
-- Making someone a platform admin takes them out of every organization (a platform admin is never a member).
-- Until now that membership was simply deleted, so removing the platform admin role later left them in no
-- organization. Now their memberships (organization, role, active, departments) are remembered, and removing
-- the role puts them straight back. Someone made platform admin before this has nothing remembered: the
-- Admin site then asks which organization and role to send them to.

create table if not exists tt_platform_admin_origins (
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references tt_organizations(id) on delete cascade,
  role text not null,
  active boolean not null default true,
  dept_ids uuid[] not null default '{}',
  saved_at timestamptz not null default now(),
  primary key (user_id, org_id)
);
alter table tt_platform_admin_origins enable row level security;
drop policy if exists origins_platform_read on tt_platform_admin_origins;
create policy origins_platform_read on tt_platform_admin_origins for select to authenticated using (tt_is_platform_admin());

drop function if exists tt_platform_set_admin(text, boolean);
create or replace function tt_platform_set_admin(p_email text, p_on boolean, p_org uuid default null, p_role text default 'employee') returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if not tt_is_platform_admin() then raise exception 'Not authorized'; end if;
  select id into u from auth.users where lower(email) = lower(trim(p_email));
  if u is null then raise exception 'No account with that email. They need to sign up or be invited first.'; end if;
  perform set_config('tt.rpc', 'on', true);
  if p_on then
    -- remember where they were, so removing the role later sends them back
    insert into tt_platform_admin_origins(user_id, org_id, role, active, dept_ids)
      select m.user_id, m.org_id, m.role, m.active,
             coalesce((select array_agg(d.department_id) from tt_department_members d where d.user_id = m.user_id and d.org_id = m.org_id), '{}')
      from tt_org_members m where m.user_id = u
    on conflict (user_id, org_id) do update set role = excluded.role, active = excluded.active, dept_ids = excluded.dept_ids, saved_at = now();
    insert into tt_platform_admins(user_id) values (u) on conflict do nothing;
    delete from tt_department_members where user_id = u;
    delete from tt_org_members where user_id = u;
  else
    if (select count(*) from tt_platform_admins) <= 1 and exists (select 1 from tt_platform_admins where user_id = u) then
      raise exception 'There must be at least one platform admin';
    end if;
    delete from tt_platform_admins where user_id = u;
    if exists (select 1 from tt_platform_admin_origins where user_id = u) then
      insert into tt_org_members(org_id, user_id, role, active)
        select o.org_id, u, case when o.role in ('admin', 'owner') then 'admin' else 'employee' end, o.active
        from tt_platform_admin_origins o where o.user_id = u
      on conflict (org_id, user_id) do nothing;
      insert into tt_department_members(department_id, user_id, org_id)
        select d.id, u, d.org_id from tt_platform_admin_origins o join tt_departments d on d.id = any(o.dept_ids) and d.org_id = o.org_id
        where o.user_id = u
      on conflict do nothing;
      delete from tt_platform_admin_origins where user_id = u;
    elsif p_org is not null then
      if not exists (select 1 from tt_organizations where id = p_org) then raise exception 'That organization no longer exists'; end if;
      if p_role not in ('admin', 'employee') then raise exception 'Role must be admin or employee'; end if;
      insert into tt_org_members(org_id, user_id, role, active) values (p_org, u, p_role, true) on conflict (org_id, user_id) do nothing;
    end if;
  end if;
end $$;
revoke all on function tt_platform_set_admin(text, boolean, uuid, text) from public, anon;
grant execute on function tt_platform_set_admin(text, boolean, uuid, text) to authenticated;
