-- REVIEW BEFORE APPLYING. Run after 0019.
-- Every organization now has just three roles: admin, manager, employee. Existing owners become admins.
-- The person who created an organization is remembered (created_by); they can't be demoted, deactivated or removed,
-- and only they (or a platform admin) can delete the organization.

alter table tt_organizations add column if not exists created_by uuid references auth.users(id) on delete set null;

-- creator = earliest owner, else earliest admin
update tt_organizations o set created_by = (
  select m.user_id from tt_org_members m where m.org_id = o.id and m.role in ('owner','admin')
  order by (m.role = 'owner') desc, m.created_at limit 1)
where o.created_by is null;

-- owners -> admins (run from the SQL editor, so the membership guard doesn't apply)
update tt_org_members set role = 'admin' where role = 'owner';
alter table tt_org_members drop constraint if exists tt_org_members_role_check;
alter table tt_org_members add constraint tt_org_members_role_check check (role in ('admin','manager','employee'));
alter table tt_org_members alter column role set default 'employee';

-- creator protection replaces the old owner-only rule
create or replace function tt_members_guard() returns trigger language plpgsql as $$
declare creator uuid;
begin
  if auth.uid() is null or coalesce(current_setting('tt.rpc', true), '') = 'on' or tt_is_platform_admin() then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then return new; end if;
  select created_by into creator from tt_organizations where id = old.org_id;
  if old.user_id = creator and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active) then
    raise exception 'The person who created this organization stays an active admin';
  end if;
  return coalesce(new, old);
end $$;

-- organizations are created with the creator as admin
create or replace function tt_create_organization(p_name text, p_slug text, p_tz text default 'UTC') returns uuid
language plpgsql security definer set search_path = public as $$
declare oid uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not tt_is_platform_admin()
     and exists (select 1 from tt_org_members where user_id = auth.uid() and active)
     and not exists (select 1 from tt_org_members where user_id = auth.uid() and active and role = 'admin') then
    raise exception 'Only admins can create a new organization';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Organization name is required'; end if;
  if p_slug !~ '^[a-z0-9][a-z0-9-]{1,40}$' then raise exception 'Slug must be 2-41 chars: lowercase letters, digits, hyphens'; end if;
  if not exists (select 1 from pg_timezone_names where name = p_tz) then raise exception 'Unknown time zone'; end if;
  insert into tt_organizations(name, slug, time_zone, created_by) values (trim(p_name), p_slug, p_tz, auth.uid()) returning id into oid;
  perform set_config('tt.rpc', 'on', true);
  insert into tt_org_members(org_id, user_id, role) values (oid, auth.uid(), 'admin');
  perform tt_log(oid, 'organization', oid, 'created', '{}');
  return oid;
end $$;

-- admins edit other people (was: owners and admins, with an owner-only rule)
create or replace function tt_admin_update_profile(p_org uuid, p_user uuid, p_full_name text, p_job_title text, p_department text, p_phone text, p_location text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(tt_role(p_org), '') not in ('owner','admin') then raise exception 'Only admins can edit other people'; end if;
  if not exists (select 1 from tt_org_members where org_id = p_org and user_id = p_user) then raise exception 'That person is not in this organization'; end if;
  update tt_profiles set full_name = nullif(trim(p_full_name), ''), job_title = nullif(trim(p_job_title), ''), department = nullif(trim(p_department), ''),
    phone = nullif(trim(p_phone), ''), location = nullif(trim(p_location), ''), updated_at = now()
  where user_id = p_user;
  perform tt_log(p_org, 'member', p_user, 'profile_edited_by_admin', '{}'::jsonb);
end $$;

drop policy if exists org_delete on tt_organizations;
create policy org_delete on tt_organizations for delete to authenticated
  using (created_by = auth.uid() or tt_is_platform_admin());
