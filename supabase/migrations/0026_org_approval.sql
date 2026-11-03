-- REVIEW BEFORE APPLYING. Run after 0025.
-- New organizations wait for a platform admin to approve them (or reject them).
-- Until approved, the organization's members have no access to it; the creator can only see its status.
-- Existing organizations are marked approved, so nothing changes for them.

alter table tt_organizations add column if not exists status text not null default 'approved'
  check (status in ('pending', 'approved', 'rejected'));

-- members count only in approved organizations; platform admins still see every organization
create or replace function tt_is_org_member(p_org uuid, p_roles text[] default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from tt_org_members m join tt_organizations o on o.id = m.org_id and o.status = 'approved'
      where m.org_id = p_org and m.user_id = auth.uid() and m.active and (p_roles is null or m.role = any(p_roles)))
    or (exists (select 1 from tt_platform_admins where user_id = auth.uid()) and exists (select 1 from tt_organizations where id = p_org));
$$;

create or replace function tt_role(p_org uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select m.role from tt_org_members m join tt_organizations o on o.id = m.org_id and o.status = 'approved'
      where m.org_id = p_org and m.user_id = auth.uid() and m.active),
    (select 'owner' from tt_platform_admins where user_id = auth.uid() and exists (select 1 from tt_organizations where id = p_org)));
$$;

-- the creator can see their own request while it waits or after it is rejected
drop policy if exists org_read_own_request on tt_organizations;
create policy org_read_own_request on tt_organizations for select to authenticated using (created_by = auth.uid());

-- same as 0021, but organizations made by anyone other than a platform admin start as pending,
-- and every platform admin is told there is one to review
create or replace function tt_create_organization(p_name text, p_slug text, p_tz text default 'UTC') returns uuid
language plpgsql security definer set search_path = public as $$
declare oid uuid; pa boolean := tt_is_platform_admin(); a uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not pa
     and exists (select 1 from tt_org_members where user_id = auth.uid() and active)
     and not exists (select 1 from tt_org_members where user_id = auth.uid() and active and role = 'admin') then
    raise exception 'Only admins can create a new organization';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Organization name is required'; end if;
  if p_slug !~ '^[a-z0-9][a-z0-9-]{1,40}$' then raise exception 'Slug must be 2-41 chars: lowercase letters, digits, hyphens'; end if;
  if not exists (select 1 from pg_timezone_names where name = p_tz) then raise exception 'Unknown time zone'; end if;
  insert into tt_organizations(name, slug, time_zone, created_by, status)
  values (trim(p_name), p_slug, p_tz, case when pa then null else auth.uid() end, case when pa then 'approved' else 'pending' end)
  returning id into oid;
  if not pa then
    perform set_config('tt.rpc', 'on', true);
    insert into tt_org_members(org_id, user_id, role) values (oid, auth.uid(), 'admin');
    for a in select user_id from tt_platform_admins loop
      perform tt_notify(oid, a, 'org_review', 'New organization to review: ' || trim(p_name), 'Approve or reject it on the Admin site.', '/admin-site', 'orgreq:' || oid || ':' || a);
    end loop;
  end if;
  perform tt_log(oid, 'organization', oid, 'created', '{}');
  return oid;
end $$;

-- platform admins approve or reject; the creator is told either way
create or replace function tt_platform_review_org(p_org uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare o tt_organizations;
begin
  if not tt_is_platform_admin() then raise exception 'Not authorized'; end if;
  update tt_organizations set status = case when p_approve then 'approved' else 'rejected' end
  where id = p_org and status <> 'approved' returning * into o;
  if not found then raise exception 'That organization is not waiting for review'; end if;
  if o.created_by is not null then
    perform tt_notify(o.id, o.created_by, 'org_review',
      case when p_approve then o.name || ' is approved' else o.name || ' was not approved' end,
      case when p_approve then 'Sign in to start using it and invite your team.' else 'Contact the Taskify team if you think this is a mistake.' end,
      '/', 'orgreview:' || o.id || ':' || o.status);
  end if;
  perform tt_log(o.id, 'organization', o.id, case when p_approve then 'approved' else 'rejected' end, '{}');
end $$;
revoke all on function tt_platform_review_org(uuid, boolean) from public, anon;
grant execute on function tt_platform_review_org(uuid, boolean) to authenticated;

-- 0025's guard plus: only platform admins (or the server) change an organization's approval status
create or replace function tt_org_guard() returns trigger language plpgsql as $$
begin
  if new.created_by is distinct from old.created_by and auth.uid() is not null and not tt_is_platform_admin() then
    raise exception 'The organization''s creator can''t be changed';
  end if;
  if new.status is distinct from old.status and auth.uid() is not null and not tt_is_platform_admin() then
    raise exception 'Only a platform admin can approve an organization';
  end if;
  if new.time_zone is distinct from old.time_zone and not exists (select 1 from pg_timezone_names where name = new.time_zone) then
    raise exception 'Unknown time zone';
  end if;
  return new;
end $$;

-- the Admin site list, with each organization's status (requests waiting first)
drop function if exists tt_platform_orgs();
create function tt_platform_orgs() returns table(id uuid, name text, time_zone text, created_at timestamptz, members bigint, open_tasks bigint, status text, creator_email text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not tt_is_platform_admin() then raise exception 'Not authorized'; end if;
  return query select o.id, o.name, o.time_zone, o.created_at,
    (select count(*) from tt_org_members m where m.org_id = o.id and m.active),
    (select count(*) from tt_tasks t where t.org_id = o.id and t.archived_at is null and t.status not in ('completed','completed_cycle')),
    o.status, (select p.email from tt_profiles p where p.user_id = o.created_by)
  from tt_organizations o order by (o.status = 'pending') desc, o.created_at;
end $$;
revoke all on function tt_platform_orgs() from public, anon;
grant execute on function tt_platform_orgs() to authenticated;
