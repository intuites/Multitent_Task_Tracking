-- REVIEW BEFORE APPLYING. Run after 0044. Safe to run more than once.
-- Organization admins and employees never see who the platform admins are. Wherever a platform admin's name would
-- show to them (comments, task history, activity, emails), it reads "Taskify admin" instead.
-- (Platform admins are already in no people list, picker or search, and their profiles and the platform admin list
--  are readable only by platform admins.)

-- comments copy the author's name when written: a platform admin's comment is signed "Taskify admin"
create or replace function tt_comment_before() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from tt_platform_admins where user_id = new.user_id) then new.author_name := 'Taskify admin';
    else select coalesce(full_name, email) into new.author_name from tt_profiles where user_id = new.user_id; end if;
  elsif new.body is distinct from old.body then
    insert into tt_task_comment_edits(comment_id, old_body, edited_by) values (old.id, old.body, auth.uid());
    new.edited_at := now();
  end if;
  return new;
end $$;

-- comments platform admins already wrote
select set_config('tt.rpc', 'on', false);
update tt_task_comments c set author_name = 'Taskify admin'
  where exists (select 1 from tt_platform_admins p where p.user_id = c.user_id) and author_name is distinct from 'Taskify admin';
select set_config('tt.rpc', '', false);

-- the app asks this for a person it can't see: says only whether they are a platform admin, never who they are
create or replace function tt_is_platform_admin_id(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from tt_platform_admins where user_id = p_user);
$$;
revoke all on function tt_is_platform_admin_id(uuid) from public, anon;
grant execute on function tt_is_platform_admin_id(uuid) to authenticated;
