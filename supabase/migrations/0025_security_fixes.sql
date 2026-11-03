-- REVIEW BEFORE APPLYING. Run after 0024.
-- Security fixes from the 2026-11-04 audit (quick, source-only run). Nothing here deletes data.
--   1. Rows that point at a task, department or file must belong to the same organization as the row.
--   2. Task assignees and watchers must be active members of the task's organization.
--   3. People join an organization only through an invite (or by creating it); members can't be re-keyed;
--      the creator stays an active admin even for server (service-role) writes.
--   4. Organization creator can't be changed by admins; time zone must be a real zone.
--   5. Users can't change the email on their own profile (it decides who gets notification emails).
--   6. Admins edit another person's profile only if that person belongs to no other organization.
--   7. Task CC emails: at most 25, each a valid address.
--   8. Cron-only and helper functions are not callable by browsers.
--   9. The invite API looks people up by their login email, not the editable profile email.

-- 1 + 2 + 7: one guard for rows that reference other rows
create or replace function tt_refs_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare t_org uuid; svc boolean := auth.uid() is null or coalesce(current_setting('tt.rpc', true), '') = 'on';
begin
  if tg_table_name in ('tt_task_comments', 'tt_task_checklist_items', 'tt_task_recurrence') then
    select org_id into t_org from tt_tasks where id = new.task_id;
    if t_org is distinct from new.org_id then raise exception 'That task is not in this organization'; end if;

  elsif tg_table_name = 'tt_files' then
    if split_part(new.path, '/', 1) <> new.org_id::text then raise exception 'File path must be inside this organization'; end if;
    if new.entity_type = 'task' then
      select org_id into t_org from tt_tasks where id = new.entity_id;
      if t_org is distinct from new.org_id then raise exception 'That task is not in this organization'; end if;
    end if;

  elsif tg_table_name = 'tt_tasks' then
    if new.parent_task_id is not null and (tg_op = 'INSERT' or new.parent_task_id is distinct from old.parent_task_id)
       and not exists (select 1 from tt_tasks where id = new.parent_task_id and org_id = new.org_id) then
      raise exception 'The parent task is not in this organization';
    end if;
    if new.department_id is not null and (tg_op = 'INSERT' or new.department_id is distinct from old.department_id)
       and not exists (select 1 from tt_departments where id = new.department_id and org_id = new.org_id) then
      raise exception 'That department is not in this organization';
    end if;
    if tg_op = 'INSERT' or new.notify_emails is distinct from old.notify_emails then
      if cardinality(new.notify_emails) > 25 then raise exception 'At most 25 emails can be notified'; end if;
      if exists (select 1 from unnest(new.notify_emails) e where e !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
        raise exception 'Notify emails must be valid email addresses';
      end if;
    end if;

  elsif tg_table_name in ('tt_task_assignees', 'tt_task_watchers') then
    -- server jobs (recurring copies) keep their historical assignees; people must be active members otherwise
    if not svc and not exists (select 1 from tt_tasks t join tt_org_members m on m.org_id = t.org_id
                               where t.id = new.task_id and m.user_id = new.user_id and m.active) then
      raise exception 'That person is not an active member of this organization';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists tt_refs_guard_trg on tt_task_comments;
create trigger tt_refs_guard_trg before insert or update on tt_task_comments for each row execute function tt_refs_guard();
drop trigger if exists tt_refs_guard_trg on tt_task_checklist_items;
create trigger tt_refs_guard_trg before insert or update on tt_task_checklist_items for each row execute function tt_refs_guard();
drop trigger if exists tt_refs_guard_trg on tt_task_recurrence;
create trigger tt_refs_guard_trg before insert or update on tt_task_recurrence for each row execute function tt_refs_guard();
drop trigger if exists tt_refs_guard_trg on tt_files;
create trigger tt_refs_guard_trg before insert or update on tt_files for each row execute function tt_refs_guard();
drop trigger if exists tt_refs_guard_trg on tt_tasks;
create trigger tt_refs_guard_trg before insert or update on tt_tasks for each row execute function tt_refs_guard();
drop trigger if exists tt_refs_guard_trg on tt_task_assignees;
create trigger tt_refs_guard_trg before insert or update on tt_task_assignees for each row execute function tt_refs_guard();
drop trigger if exists tt_refs_guard_trg on tt_task_watchers;
create trigger tt_refs_guard_trg before insert or update on tt_task_watchers for each row execute function tt_refs_guard();

-- 3: same as 0021 plus: no direct inserts by users, no re-keying, creator rule also for the service role
create or replace function tt_members_guard() returns trigger language plpgsql as $$
declare creator uuid;
begin
  if tg_op <> 'DELETE' and exists (select 1 from tt_platform_admins where user_id = new.user_id) then
    raise exception 'Platform admins can''t be members of an organization; they already have access to every organization';
  end if;
  if coalesce(current_setting('tt.rpc', true), '') = 'on' or tt_is_platform_admin() then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then
    if auth.uid() is not null then raise exception 'People join an organization through an invitation'; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and (new.org_id, new.user_id) is distinct from (old.org_id, old.user_id) then
    raise exception 'A membership can''t be moved to another person or organization';
  end if;
  select created_by into creator from tt_organizations where id = old.org_id;
  if old.user_id = creator and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active) then
    raise exception 'The person who created this organization stays an active admin';
  end if;
  return coalesce(new, old);
end $$;

-- 4
create or replace function tt_org_guard() returns trigger language plpgsql as $$
begin
  if new.created_by is distinct from old.created_by and auth.uid() is not null and not tt_is_platform_admin() then
    raise exception 'The organization''s creator can''t be changed';
  end if;
  if new.time_zone is distinct from old.time_zone and not exists (select 1 from pg_timezone_names where name = new.time_zone) then
    raise exception 'Unknown time zone';
  end if;
  return new;
end $$;
drop trigger if exists tt_org_guard_trg on tt_organizations;
create trigger tt_org_guard_trg before update on tt_organizations for each row execute function tt_org_guard();

-- 5
create or replace function tt_profile_guard() returns trigger language plpgsql as $$
begin
  if new.email is distinct from old.email and auth.uid() is not null then
    raise exception 'Your email is your login email and can''t be changed here';
  end if;
  return new;
end $$;
drop trigger if exists tt_profile_guard_trg on tt_profiles;
create trigger tt_profile_guard_trg before update on tt_profiles for each row execute function tt_profile_guard();

-- 6: same as 0020, but the person must be an active member here and in no other organization
create or replace function tt_admin_update_profile(p_org uuid, p_user uuid, p_full_name text, p_job_title text, p_department text, p_phone text, p_location text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(tt_role(p_org), '') not in ('owner','admin') then raise exception 'Only admins can edit other people'; end if;
  if not exists (select 1 from tt_org_members where org_id = p_org and user_id = p_user and active) then raise exception 'That person is not in this organization'; end if;
  if exists (select 1 from tt_org_members where user_id = p_user and active and org_id <> p_org) then
    raise exception 'This person also belongs to another organization, so only they can edit their profile';
  end if;
  update tt_profiles set full_name = nullif(trim(p_full_name), ''), job_title = nullif(trim(p_job_title), ''), department = nullif(trim(p_department), ''),
    phone = nullif(trim(p_phone), ''), location = nullif(trim(p_location), ''), updated_at = now()
  where user_id = p_user;
  perform tt_log(p_org, 'member', p_user, 'profile_edited_by_admin', '{}'::jsonb);
end $$;

-- 8
revoke execute on function tt_generate_task_reminders(int) from public, anon, authenticated;
grant execute on function tt_generate_task_reminders(int) to service_role;
revoke execute on function tt_task_participants(uuid) from public, anon, authenticated;

-- 9: login-email lookup for the invite API (server only)
create or replace function tt_user_id_by_email(p_email text) returns uuid language sql stable security definer set search_path = public as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1
$$;
revoke execute on function tt_user_id_by_email(text) from public, anon, authenticated;
grant execute on function tt_user_id_by_email(text) to service_role;
