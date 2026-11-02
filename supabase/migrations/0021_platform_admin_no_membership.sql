-- REVIEW BEFORE APPLYING. Run after 0020.
-- Platform admin is its own role above every organization: it never belongs to one.
-- It opens any organization and has full create/read/update/delete there without an invitation
-- (tt_is_org_member / tt_role already treat platform admins as full admins of every organization, see 0018).

-- 1. existing platform admins leave every organization (their past tasks, comments and history stay)
delete from tt_org_members m using tt_platform_admins p where p.user_id = m.user_id;
delete from tt_department_members m using tt_platform_admins p where p.user_id = m.user_id;

-- 2. a platform admin can never be added to an organization (checked even for the service role / invite API)
create or replace function tt_members_guard() returns trigger language plpgsql as $$
declare creator uuid;
begin
  if tg_op <> 'DELETE' and exists (select 1 from tt_platform_admins where user_id = new.user_id) then
    raise exception 'Platform admins can''t be members of an organization; they already have access to every organization';
  end if;
  if auth.uid() is null or coalesce(current_setting('tt.rpc', true), '') = 'on' or tt_is_platform_admin() then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then return new; end if;
  select created_by into creator from tt_organizations where id = old.org_id;
  if old.user_id = creator and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active) then
    raise exception 'The person who created this organization stays an active admin';
  end if;
  return coalesce(new, old);
end $$;

-- 3. organizations a platform admin creates have no member yet; they invite the organization's admin
create or replace function tt_create_organization(p_name text, p_slug text, p_tz text default 'UTC') returns uuid
language plpgsql security definer set search_path = public as $$
declare oid uuid; pa boolean := tt_is_platform_admin();
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
  insert into tt_organizations(name, slug, time_zone, created_by) values (trim(p_name), p_slug, p_tz, case when pa then null else auth.uid() end) returning id into oid;
  if not pa then
    perform set_config('tt.rpc', 'on', true);
    insert into tt_org_members(org_id, user_id, role) values (oid, auth.uid(), 'admin');
  end if;
  perform tt_log(oid, 'organization', oid, 'created', '{}');
  return oid;
end $$;

-- 4. making someone a platform admin takes them out of every organization
create or replace function tt_platform_set_admin(p_email text, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if not tt_is_platform_admin() then raise exception 'Not authorized'; end if;
  select id into u from auth.users where lower(email) = lower(trim(p_email));
  if u is null then raise exception 'No account with that email. They need to sign up or be invited first.'; end if;
  if p_on then
    insert into tt_platform_admins(user_id) values (u) on conflict do nothing;
    delete from tt_department_members where user_id = u;
    perform set_config('tt.rpc', 'on', true);
    delete from tt_org_members where user_id = u;
  else
    if (select count(*) from tt_platform_admins) <= 1 and exists (select 1 from tt_platform_admins where user_id = u) then
      raise exception 'There must be at least one platform admin';
    end if;
    delete from tt_platform_admins where user_id = u;
  end if;
end $$;
