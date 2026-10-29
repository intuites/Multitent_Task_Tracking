-- REVIEW BEFORE APPLYING. Additive only. Richer profile fields and a self-service "leave organization".

alter table tt_profiles add column if not exists job_title text check (char_length(job_title) <= 120);
alter table tt_profiles add column if not exists department text check (char_length(department) <= 120);
alter table tt_profiles add column if not exists phone text check (char_length(phone) <= 40);
alter table tt_profiles add column if not exists location text check (char_length(location) <= 120);
alter table tt_profiles add column if not exists bio text check (char_length(bio) <= 1000);
alter table tt_profiles add column if not exists updated_at timestamptz;

-- Members can leave an organization themselves. The last owner can't, so an org is never left without one.
create or replace function tt_leave_org(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r text;
begin
  select role into r from tt_org_members where org_id = p_org and user_id = auth.uid() and active;
  if r is null then raise exception 'You are not a member of this organization'; end if;
  if r = 'owner' and (select count(*) from tt_org_members where org_id = p_org and role = 'owner' and active) <= 1 then
    raise exception 'You are the only owner. Make someone else an owner before leaving.';
  end if;
  delete from tt_task_assignees a using tt_tasks t
    where a.task_id = t.id and t.org_id = p_org and a.user_id = auth.uid() and t.status not in ('completed','cancelled');
  delete from tt_org_members where org_id = p_org and user_id = auth.uid();
  perform tt_log(p_org, 'member', auth.uid(), 'left_organization', '{}'::jsonb);
end $$;
revoke all on function tt_leave_org(uuid) from public;
grant execute on function tt_leave_org(uuid) to authenticated;
