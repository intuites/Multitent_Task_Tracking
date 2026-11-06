-- REVIEW BEFORE APPLYING. Run after 0035. Safe to run more than once.
-- 1. Personal look: everyone can pick their own theme, color, font, italic and text size (saved with their account).
-- 2. The organization's default text size.
-- 3. Optional: admins must use two-factor sign-in (off by default). Without the second step an admin only has
--    employee rights in that organization, enforced here so it can't be skipped from the browser.

-- ───────── 1. personal look: { theme, color, font, style, size }, written by the person through profiles_update_self
alter table tt_profiles add column if not exists prefs jsonb not null default '{}'::jsonb;
alter table tt_profiles drop constraint if exists tt_profiles_prefs_chk;
alter table tt_profiles add constraint tt_profiles_prefs_chk check (jsonb_typeof(prefs) = 'object' and length(prefs::text) <= 2000);

-- ───────── 2. organization default text size (null = normal)
alter table tt_organizations add column if not exists text_size text;
alter table tt_organizations drop constraint if exists tt_organizations_text_size_chk;
alter table tt_organizations add constraint tt_organizations_text_size_chk check (text_size is null or text_size in ('compact', 'normal', 'large'));

-- ───────── 3. two-factor sign-in for admins
alter table tt_organizations add column if not exists require_admin_mfa boolean not null default false;

-- true when this organization wants two-factor from admins and the caller's session hasn't done it
create or replace function tt_mfa_missing(p_org uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select require_admin_mfa from tt_organizations where id = p_org), false)
     and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2';
$$;

-- same as 0026, except admin rights (owner/admin) need two-factor where the organization requires it
create or replace function tt_role(p_org uuid) returns text language sql stable security definer set search_path = public as $$
  select case when r in ('owner', 'admin') and tt_mfa_missing(p_org) then 'employee' else r end
  from (select coalesce(
    (select m.role from tt_org_members m join tt_organizations o on o.id = m.org_id and o.status = 'approved'
      where m.org_id = p_org and m.user_id = auth.uid() and m.active),
    (select 'owner' from tt_platform_admins where user_id = auth.uid() and exists (select 1 from tt_organizations where id = p_org))) as r) x;
$$;

-- same as 0026; a role check that asks for owner/admin fails without two-factor where it is required
create or replace function tt_is_org_member(p_org uuid, p_roles text[] default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from tt_org_members m join tt_organizations o on o.id = m.org_id and o.status = 'approved'
      where m.org_id = p_org and m.user_id = auth.uid() and m.active
        and (p_roles is null or (m.role = any(p_roles) and not (m.role in ('owner', 'admin') and tt_mfa_missing(p_org)))))
    or (exists (select 1 from tt_platform_admins where user_id = auth.uid()) and exists (select 1 from tt_organizations where id = p_org)
        and (p_roles is null or not tt_mfa_missing(p_org)));
$$;

-- nobody locks themselves out: turning the rule on needs a two-factor session
create or replace function tt_org_mfa_guard() returns trigger language plpgsql as $$
begin
  if new.require_admin_mfa and not coalesce(old.require_admin_mfa, false) and auth.uid() is not null
     and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Set up two-factor sign-in for yourself first, then turn this on';
  end if;
  return new;
end $$;
drop trigger if exists tt_org_mfa_guard_trg on tt_organizations;
create trigger tt_org_mfa_guard_trg before update of require_admin_mfa on tt_organizations for each row execute function tt_org_mfa_guard();
