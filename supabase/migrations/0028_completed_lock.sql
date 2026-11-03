-- REVIEW BEFORE APPLYING. Run after 0027.
-- A task marked Completed (permanently) stays closed: only admins and platform admins can reopen it.
-- Employees can still mark their tasks completed; they just can't move them out of Completed afterwards.
-- "Completed this cycle" is unaffected (it reopens on its next cycle as before).

create or replace function tt_completed_lock() returns trigger language plpgsql as $$
begin
  if old.status = 'completed' and new.status is distinct from 'completed'
     and auth.uid() is not null and coalesce(tt_role(old.org_id), '') not in ('owner', 'admin') then
    raise exception 'This task is completed. Only an admin can reopen it.';
  end if;
  return new;
end $$;
drop trigger if exists tt_completed_lock_trg on tt_tasks;
create trigger tt_completed_lock_trg before update of status on tt_tasks for each row execute function tt_completed_lock();
