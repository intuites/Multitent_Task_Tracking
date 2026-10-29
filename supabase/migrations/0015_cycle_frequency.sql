-- REVIEW BEFORE APPLYING. Run after 0014.
-- Lets an assignee (or a manager+) give a task its repeat cycle when marking it "Completed this cycle".
-- Only the frequency and its start day change; employees still can't edit anything else on the task.
create or replace function tt_set_cycle_frequency(p_task uuid, p_freq text) returns void
language plpgsql security definer set search_path = public as $$
declare t tt_tasks; r text;
begin
  select * into t from tt_tasks where id = p_task;
  if not found then raise exception 'Task not found'; end if;
  r := tt_role(t.org_id);
  if r is null or (r not in ('owner','admin','manager')
                   and not exists (select 1 from tt_task_assignees where task_id = p_task and user_id = auth.uid())) then
    raise exception 'Only assignees or managers can change this task';
  end if;
  if p_freq is null or p_freq not in ('daily','weekdays','weekly','monthly','quarterly','semiannual','yearly') then
    raise exception 'Choose how often this task repeats';
  end if;
  update tt_tasks set reminder_frequency = p_freq,
    reminder_start = coalesce(reminder_start, (now() at time zone 'America/New_York')::date)
  where id = p_task;
  perform tt_log(t.org_id, 'task', p_task, 'cycle_set', jsonb_build_object('frequency', p_freq));
end $$;
revoke all on function tt_set_cycle_frequency(uuid, text) from public;
grant execute on function tt_set_cycle_frequency(uuid, text) to authenticated;
