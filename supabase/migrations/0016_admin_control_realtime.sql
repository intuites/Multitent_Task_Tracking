-- REVIEW BEFORE APPLYING. Run after 0015.
-- 1. Owners and admins can edit any member's profile details (name, title, department, phone, location).
--    Admins can't edit an owner; only an owner can (same rule as role changes).
-- 2. Task changes are published to Supabase Realtime so dashboards update live (RLS still applies to every event).

create or replace function tt_admin_update_profile(p_org uuid, p_user uuid, p_full_name text, p_job_title text, p_department text, p_phone text, p_location text)
returns void language plpgsql security definer set search_path = public as $$
declare me text; target text;
begin
  me := tt_role(p_org);
  if me is null or me not in ('owner','admin') then raise exception 'Only owners and admins can edit other people'; end if;
  select role into target from tt_org_members where org_id = p_org and user_id = p_user;
  if target is null then raise exception 'That person is not in this organization'; end if;
  if target = 'owner' and me <> 'owner' and p_user <> auth.uid() then raise exception 'Only an owner can edit an owner'; end if;
  update tt_profiles set
    full_name = nullif(trim(p_full_name), ''), job_title = nullif(trim(p_job_title), ''), department = nullif(trim(p_department), ''),
    phone = nullif(trim(p_phone), ''), location = nullif(trim(p_location), ''), updated_at = now()
  where user_id = p_user;
  perform tt_log(p_org, 'member', p_user, 'profile_edited_by_admin', '{}'::jsonb);
end $$;
revoke all on function tt_admin_update_profile(uuid, uuid, text, text, text, text, text) from public;
grant execute on function tt_admin_update_profile(uuid, uuid, text, text, text, text, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'tt_tasks') then
      alter publication supabase_realtime add table tt_tasks;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'tt_task_assignees') then
      alter publication supabase_realtime add table tt_task_assignees;
    end if;
  end if;
end $$;
