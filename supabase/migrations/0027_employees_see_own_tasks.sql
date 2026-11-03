-- REVIEW BEFORE APPLYING. Run after 0026.
-- Employees see only their own work: tasks they are assigned to, watch or created, plus the subtasks and parent
-- of those tasks. Admins and platform admins still see every task in the organization.
-- Applies to tasks and everything hanging off a task (assignees, comments, files, checklist, history, ...),
-- so the calendar, dashboard, search and task pages all show an employee only their own data.

create or replace function tt_can_see_task(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from tt_tasks t where t.id = p_task and (
    tt_is_org_member(t.org_id, array['owner','admin','manager'])
    or (tt_is_org_member(t.org_id) and (
      t.created_by = auth.uid()
      or exists (select 1 from tt_task_assignees a where a.user_id = auth.uid() and a.task_id in (t.id, t.parent_task_id))
      or exists (select 1 from tt_task_watchers w where w.user_id = auth.uid() and w.task_id in (t.id, t.parent_task_id))
      or exists (select 1 from tt_tasks c join tt_task_assignees a on a.task_id = c.id where c.parent_task_id = t.id and a.user_id = auth.uid())
      or exists (select 1 from tt_escalations e where e.task_id = t.id and e.owner_id = auth.uid())))));
$$;
revoke all on function tt_can_see_task(uuid) from public, anon;
grant execute on function tt_can_see_task(uuid) to authenticated;

drop policy if exists tasks_read on tt_tasks;
create policy tasks_read on tt_tasks for select using (tt_can_see_task(id));

drop policy if exists assignees_read on tt_task_assignees;
create policy assignees_read on tt_task_assignees for select using (tt_can_see_task(task_id));
drop policy if exists watchers_read on tt_task_watchers;
create policy watchers_read on tt_task_watchers for select using (tt_can_see_task(task_id));
drop policy if exists history_read on tt_task_status_history;
create policy history_read on tt_task_status_history for select using (tt_can_see_task(task_id));
drop policy if exists deps_read on tt_task_dependencies;
create policy deps_read on tt_task_dependencies for select using (tt_can_see_task(task_id));
drop policy if exists recur_read on tt_task_recurrence;
create policy recur_read on tt_task_recurrence for select using (tt_can_see_task(task_id));

drop policy if exists checklist_read on tt_task_checklist_items;
create policy checklist_read on tt_task_checklist_items for select using (tt_can_see_task(task_id));
drop policy if exists checklist_write on tt_task_checklist_items;
create policy checklist_write on tt_task_checklist_items for all
  using (tt_is_org_member(org_id) and tt_can_see_task(task_id)) with check (tt_is_org_member(org_id) and tt_can_see_task(task_id));

drop policy if exists comments_read on tt_task_comments;
create policy comments_read on tt_task_comments for select using (tt_can_see_task(task_id));
drop policy if exists comments_insert on tt_task_comments;
create policy comments_insert on tt_task_comments for insert
  with check (tt_is_org_member(org_id) and user_id = auth.uid() and tt_can_see_task(task_id));

drop policy if exists files_read on tt_files;
create policy files_read on tt_files for select
  using (tt_is_org_member(org_id) and (entity_type <> 'task' or tt_can_see_task(entity_id)));
drop policy if exists files_insert on tt_files;
create policy files_insert on tt_files for insert
  with check (tt_is_org_member(org_id) and uploaded_by = auth.uid() and (entity_type <> 'task' or tt_can_see_task(entity_id)));

drop policy if exists esc_read on tt_escalations;
create policy esc_read on tt_escalations for select using (tt_can_see_task(task_id));
drop policy if exists escu_read on tt_escalation_updates;
create policy escu_read on tt_escalation_updates for select
  using (exists (select 1 from tt_escalations e where e.id = escalation_id and tt_can_see_task(e.task_id)));

-- stored files follow the same rule: {org}/task/{task id}/... is readable only if the task is
drop policy if exists tt_files_member_read on storage.objects;
create policy tt_files_member_read on storage.objects for select
  using (bucket_id = 'tt-files' and tt_is_org_member(((storage.foldername(name))[1])::uuid)
    and ((storage.foldername(name))[2] is distinct from 'task' or tt_can_see_task(((storage.foldername(name))[3])::uuid)));
