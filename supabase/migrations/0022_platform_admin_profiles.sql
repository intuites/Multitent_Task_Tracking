-- REVIEW BEFORE APPLYING. Run after 0021.
-- Profiles were readable only by people who share an organization membership. Platform admins have no membership,
-- so every member showed as "Unknown". Platform admins can read every profile.
drop policy if exists profiles_read_platform on tt_profiles;
create policy profiles_read_platform on tt_profiles for select to authenticated using (tt_is_platform_admin());
