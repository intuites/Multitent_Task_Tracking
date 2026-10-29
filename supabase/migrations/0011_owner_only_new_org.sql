-- REVIEW BEFORE APPLYING. Only owners create organizations.
-- A brand-new user with no membership can still create their first one (they become its owner);
-- anyone who was invited into an org (admin, manager, employee) and owns none cannot.

create or replace function tt_create_organization(p_name text, p_slug text, p_tz text default 'UTC') returns uuid
language plpgsql security definer set search_path = public as $$
declare oid uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if exists (select 1 from tt_org_members where user_id = auth.uid() and active)
     and not exists (select 1 from tt_org_members where user_id = auth.uid() and active and role = 'owner') then
    raise exception 'Only organization owners can create a new organization';
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
