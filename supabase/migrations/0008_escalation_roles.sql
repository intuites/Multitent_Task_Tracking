-- REVIEW BEFORE APPLYING. Only owners, admins and managers may raise escalations (employees can't).
-- Same function as 0004 with a stricter role check; nothing else changes.

create or replace function tt_raise_escalation(p_task uuid, p_reason text, p_description text, p_severity text, p_owner uuid default null, p_target timestamptz default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare t tt_tasks; esc uuid; u uuid;
begin
  select * into t from tt_tasks where id = p_task for update;
  if not found then raise exception 'Task not found'; end if;
  if coalesce(tt_role(t.org_id), '') not in ('owner','admin','manager') then raise exception 'Only owners, admins and managers can raise escalations'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  if t.status in ('escalation','completed','cancelled') then raise exception 'Task cannot be escalated from status %', t.status; end if;
  if p_owner is not null and not exists (select 1 from tt_org_members where org_id = t.org_id and user_id = p_owner and active) then
    raise exception 'Escalation owner must be an active member';
  end if;
  insert into tt_escalations(org_id, task_id, reason, description, severity, owner_id, target_date, previous_task_status, raised_by)
  values (t.org_id, p_task, trim(p_reason), p_description, p_severity, p_owner, p_target, t.status, auth.uid()) returning id into esc;
  insert into tt_escalation_updates(org_id, escalation_id, user_id, state, note) values (t.org_id, esc, auth.uid(), 'open', 'Escalation raised: ' || trim(p_reason));
  perform set_config('tt.rpc', 'on', true);
  update tt_tasks set status = 'escalation' where id = p_task;
  insert into tt_task_status_history(org_id, task_id, from_status, to_status, changed_by, reason) values (t.org_id, p_task, t.status, 'escalation', auth.uid(), p_reason);
  perform tt_log(t.org_id, 'task', p_task, 'escalation_raised', jsonb_build_object('escalation', esc, 'severity', p_severity));
  for u in select user_id from tt_org_members where org_id = t.org_id and active
      and ((p_owner is not null and user_id = p_owner) or (p_owner is null and role in ('owner','admin','manager'))) loop
    if u <> auth.uid() then
      perform tt_notify(t.org_id, u, 'escalation_raised', 'Escalation (' || p_severity || '): ' || t.title, p_reason, '/escalations', null);
    end if;
  end loop;
  return esc;
end $$;
