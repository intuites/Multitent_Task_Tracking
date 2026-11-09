-- REVIEW BEFORE APPLYING. Run after 0043. Safe to run more than once.
-- Deleting a user failed with: "The manager must be a member of this organization".
-- The guard re-checked both Lead and Manager on every change to either. When someone leaves (or their account is
-- deleted) and they are both Lead and Manager on a task, clearing the Lead re-checked the Manager, who is still them
-- and no longer a member, so the whole delete stopped. Now only a Lead or Manager being set or changed is checked
-- (and both when the task moves to another organization).

create or replace function tt_task_people_guard() returns trigger language plpgsql set search_path = public as $$
declare moved boolean := tg_op = 'INSERT' or new.org_id is distinct from old.org_id;
begin
  if new.lead_id is not null and (moved or new.lead_id is distinct from old.lead_id)
     and not exists (select 1 from tt_org_members where org_id = new.org_id and user_id = new.lead_id) then
    raise exception 'The lead must be a member of this organization';
  end if;
  if new.manager_id is not null and (moved or new.manager_id is distinct from old.manager_id)
     and not exists (select 1 from tt_org_members where org_id = new.org_id and user_id = new.manager_id) then
    raise exception 'The manager must be a member of this organization';
  end if;
  return new;
end $$;
