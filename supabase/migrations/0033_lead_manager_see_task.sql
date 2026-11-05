-- A task's Lead and Manager can open it. They get its completed email and the digests, which link to the task;
-- without this an employee who leads or manages a task saw "Task not found". Same rule as 0027 plus one line.
-- Safe to run more than once. Needs 0031 (lead_id, manager_id).
create or replace function tt_can_see_task(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from tt_tasks t where t.id = p_task and (
    tt_is_org_member(t.org_id, array['owner','admin','manager'])
    or (tt_is_org_member(t.org_id) and (
      t.created_by = auth.uid()
      or auth.uid() in (t.lead_id, t.manager_id)
      or exists (select 1 from tt_task_assignees a where a.user_id = auth.uid() and a.task_id in (t.id, t.parent_task_id))
      or exists (select 1 from tt_task_watchers w where w.user_id = auth.uid() and w.task_id in (t.id, t.parent_task_id))
      or exists (select 1 from tt_tasks c join tt_task_assignees a on a.task_id = c.id where c.parent_task_id = t.id and a.user_id = auth.uid())
      or exists (select 1 from tt_escalations e where e.task_id = t.id and e.owner_id = auth.uid())))));
$$;
revoke all on function tt_can_see_task(uuid) from public, anon;
grant execute on function tt_can_see_task(uuid) to authenticated;
