-- REVIEW BEFORE APPLYING. Run after 0017.
-- Two kinds of admin:
--   * Organization admin  - a row in tt_org_members with role 'admin'; controls that one organization.
--   * Platform admin      - a row in tt_platform_admins; controls the whole CRM: every organization, as if owner.
-- Every RLS policy and workflow function asks tt_is_org_member()/tt_role(), so teaching those two about platform
-- admins gives them full access everywhere without touching each policy.

create or replace function tt_is_org_member(p_org uuid, p_roles text[] default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from tt_org_members m
      where m.org_id = p_org and m.user_id = auth.uid() and m.active and (p_roles is null or m.role = any(p_roles)))
    or (exists (select 1 from tt_platform_admins where user_id = auth.uid()) and exists (select 1 from tt_organizations where id = p_org));
$$;

-- a platform admin who isn't a member acts as owner
create or replace function tt_role(p_org uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role from tt_org_members where org_id = p_org and user_id = auth.uid() and active),
    (select 'owner' from tt_platform_admins where user_id = auth.uid() and exists (select 1 from tt_organizations where id = p_org)));
$$;

-- owners, org admins and platform admins can create organizations
create or replace function tt_create_organization(p_name text, p_slug text, p_tz text default 'UTC') returns uuid
language plpgsql security definer set search_path = public as $$
declare oid uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not tt_is_platform_admin()
     and exists (select 1 from tt_org_members where user_id = auth.uid() and active)
     and not exists (select 1 from tt_org_members where user_id = auth.uid() and active and role in ('owner','admin')) then
    raise exception 'Only organization owners and admins can create a new organization';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Organization name is required'; end if;
  if p_slug !~ '^[a-z0-9][a-z0-9-]{1,40}$' then raise exception 'Slug must be 2-41 chars: lowercase letters, digits, hyphens'; end if;
  if not exists (select 1 from pg_timezone_names where name = p_tz) then raise exception 'Unknown time zone'; end if;
  insert into tt_organizations(name, slug, time_zone) values (trim(p_name), p_slug, p_tz) returning id into oid;
  perform set_config('tt.rpc', 'on', true);
  insert into tt_org_members(org_id, user_id, role) values (oid, auth.uid(), 'owner');
  perform tt_log(oid, 'organization', oid, 'created', '{}');
  return oid;
end $$;

-- every organization with a few counts, for the Platform page
create or replace function tt_platform_orgs() returns table(id uuid, name text, time_zone text, created_at timestamptz, members bigint, open_tasks bigint, clients bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not tt_is_platform_admin() then raise exception 'Not authorized'; end if;
  return query select o.id, o.name, o.time_zone, o.created_at,
    (select count(*) from tt_org_members m where m.org_id = o.id and m.active),
    (select count(*) from tt_tasks t where t.org_id = o.id and t.archived_at is null and t.status not in ('completed','completed_cycle')),
    (select count(*) from tt_clients c where c.org_id = o.id)
  from tt_organizations o order by o.created_at;
end $$;

-- list / grant / revoke platform admins (platform admins only; the last one can't be removed)
create or replace function tt_platform_admin_list() returns table(user_id uuid, email text, full_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not tt_is_platform_admin() then raise exception 'Not authorized'; end if;
  return query select a.user_id, p.email, p.full_name from tt_platform_admins a left join tt_profiles p on p.user_id = a.user_id order by p.email;
end $$;

create or replace function tt_platform_set_admin(p_email text, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if not tt_is_platform_admin() then raise exception 'Not authorized'; end if;
  select id into u from auth.users where lower(email) = lower(trim(p_email));
  if u is null then raise exception 'No account with that email. They need to sign up or be invited first.'; end if;
  if p_on then
    insert into tt_platform_admins(user_id) values (u) on conflict do nothing;
  else
    if (select count(*) from tt_platform_admins) <= 1 and exists (select 1 from tt_platform_admins where user_id = u) then
      raise exception 'There must be at least one platform admin';
    end if;
    delete from tt_platform_admins where user_id = u;
  end if;
end $$;

revoke all on function tt_platform_orgs() from public;
revoke all on function tt_platform_admin_list() from public;
revoke all on function tt_platform_set_admin(text, boolean) from public;
grant execute on function tt_platform_orgs() to authenticated;
grant execute on function tt_platform_admin_list() to authenticated;
grant execute on function tt_platform_set_admin(text, boolean) to authenticated;

-- First platform admin: run once with your own email (afterwards, add others from the Platform page).
-- insert into tt_platform_admins(user_id) select id from auth.users where email = 'you@company.com';
