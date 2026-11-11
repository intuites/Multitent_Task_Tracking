-- Run after 0045. Safe to run more than once.
-- Organization members see a platform admin simply as the brand, "Taskify" (0045 said "Taskify admin").
-- Same comment trigger as 0045 with only the name changed, then the comments platform admins already wrote.

create or replace function tt_comment_before() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from tt_platform_admins where user_id = new.user_id) then new.author_name := 'Taskify';
    else select coalesce(full_name, email) into new.author_name from tt_profiles where user_id = new.user_id; end if;
  elsif new.body is distinct from old.body then
    insert into tt_task_comment_edits(comment_id, old_body, edited_by) values (old.id, old.body, auth.uid());
    new.edited_at := now();
  end if;
  return new;
end $$;

select set_config('tt.rpc', 'on', false);
update tt_task_comments c set author_name = 'Taskify'
  where exists (select 1 from tt_platform_admins p where p.user_id = c.user_id) and author_name is distinct from 'Taskify';
select set_config('tt.rpc', '', false);
