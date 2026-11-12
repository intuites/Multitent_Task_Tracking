-- Run after 0050. Safe to run more than once. Adds functions only; deletes nothing by itself.
-- Platform admins can list and delete rows of one organization's data: tasks, activity logs, notifications, the email
-- delivery log, task templates and departments. Never tables, never the organization itself, its members or their profiles.

-- ───────── the kinds, and one row shape for the list: id, title, sub, at
create or replace function tt_platform_data_list(p_org uuid, p_kind text, p_from timestamptz default null, p_to timestamptz default null,
  p_q text default null, p_status text default null, p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(trim(coalesce(p_q, '')), ''); lim int := least(greatest(coalesce(p_limit, 200), 1), 1000); res jsonb; n int;
begin
  if not tt_is_platform_admin() then raise exception 'Only platform admins can do this'; end if;
  if p_kind = 'tasks' then
    select count(*), coalesce(jsonb_agg(r order by r.at desc) filter (where r.rn <= lim), '[]') into n, res from (
      select t.id, t.title, concat_ws(' · ', initcap(replace(t.status, '_', ' ')), case when t.parent_task_id is not null then 'Subtask' end,
               case when t.archived_at is not null then 'Archived' end) as sub, t.created_at as at, row_number() over (order by t.created_at desc) rn
      from tt_tasks t where t.org_id = p_org
        and (p_from is null or t.created_at >= p_from) and (p_to is null or t.created_at < p_to)
        and (q is null or t.title ilike '%' || q || '%') and (p_status is null or t.status = p_status)) r;
  elsif p_kind = 'activity' then
    select count(*), coalesce(jsonb_agg(r order by r.at desc) filter (where r.rn <= lim), '[]') into n, res from (
      select a.id, initcap(replace(a.action, '_', ' ')) as title, concat_ws(' · ', initcap(a.entity_type), coalesce(p.full_name, p.email, 'Taskify')) as sub,
             a.created_at as at, row_number() over (order by a.created_at desc) rn
      from tt_activity_logs a left join tt_profiles p on p.user_id = a.actor_id where a.org_id = p_org
        and (p_from is null or a.created_at >= p_from) and (p_to is null or a.created_at < p_to)
        and (q is null or a.action ilike '%' || q || '%' or coalesce(p.full_name, '') ilike '%' || q || '%')) r;
  elsif p_kind = 'notifications' then
    select count(*), coalesce(jsonb_agg(r order by r.at desc) filter (where r.rn <= lim), '[]') into n, res from (
      select x.id, x.title, concat_ws(' · ', 'To ' || coalesce(p.full_name, p.email, 'someone'), case when x.read_at is null then 'Unread' else 'Read' end) as sub,
             x.created_at as at, row_number() over (order by x.created_at desc) rn
      from tt_notifications x left join tt_profiles p on p.user_id = x.user_id where x.org_id = p_org
        and (p_from is null or x.created_at >= p_from) and (p_to is null or x.created_at < p_to)
        and (q is null or x.title ilike '%' || q || '%')) r;
  elsif p_kind = 'emails' then
    select count(*), coalesce(jsonb_agg(r order by r.at desc) filter (where r.rn <= lim), '[]') into n, res from (
      select e.id, coalesce(nullif(e.subject, ''), 'Email') as title, concat_ws(' · ', 'To ' || e.to_email, initcap(e.status)) as sub, e.created_at as at, row_number() over (order by e.created_at desc) rn
      from tt_email_delivery_logs e where e.org_id = p_org
        and (p_from is null or e.created_at >= p_from) and (p_to is null or e.created_at < p_to)
        and (q is null or e.subject ilike '%' || q || '%' or e.to_email ilike '%' || q || '%')) r;
  elsif p_kind = 'templates' then
    select count(*), coalesce(jsonb_agg(r order by r.at desc) filter (where r.rn <= lim), '[]') into n, res from (
      select t.id, t.name as title, t.title as sub, t.created_at as at, row_number() over (order by t.created_at desc) rn
      from tt_task_templates t where t.org_id = p_org and (q is null or t.name ilike '%' || q || '%' or t.title ilike '%' || q || '%')) r;
  elsif p_kind = 'departments' then
    select count(*), coalesce(jsonb_agg(r order by r.at desc) filter (where r.rn <= lim), '[]') into n, res from (
      select d.id, d.name as title, (select count(*) from tt_department_members m where m.department_id = d.id) || ' members' as sub,
             d.created_at as at, row_number() over (order by d.created_at desc) rn
      from tt_departments d where d.org_id = p_org and (q is null or d.name ilike '%' || q || '%')) r;
  else raise exception 'Unknown kind of data: %', p_kind;
  end if;
  return jsonb_build_object('total', n, 'rows', res);
end $$;
revoke execute on function tt_platform_data_list(uuid, text, timestamptz, timestamptz, text, text, int) from public, anon;
grant execute on function tt_platform_data_list(uuid, text, timestamptz, timestamptz, text, text, int) to authenticated;

-- ───────── delete rows of one kind in one organization. p_ids null = every row of that kind in the organization.
-- Tasks take their subtasks with them (and comments, assignees, history, files... by cascade); the files' storage paths are
-- returned so the browser can remove the stored files too. Every delete leaves one line in the activity log.
create or replace function tt_platform_delete(p_org uuid, p_kind text, p_ids uuid[] default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int := 0; paths text[] := '{}'; ids uuid[];
begin
  if not tt_is_platform_admin() then raise exception 'Only platform admins can do this'; end if;
  if not exists (select 1 from tt_organizations where id = p_org) then raise exception 'That organization does not exist'; end if;
  perform set_config('tt.rpc', 'on', true);
  if p_kind = 'tasks' then
    -- the chosen tasks and every subtask under them, only inside this organization
    with recursive pick as (
      select id from tt_tasks where org_id = p_org and (p_ids is null or id = any(p_ids))
      union select t.id from tt_tasks t join pick on t.parent_task_id = pick.id where t.org_id = p_org
    ) select array_agg(id) into ids from pick;
    if ids is not null then
      update tt_tasks set recurrence_parent_id = null where recurrence_parent_id = any(ids) and not (id = any(ids));
      select coalesce(array_agg(path), '{}') into paths from tt_files where org_id = p_org and entity_type = 'task' and entity_id = any(ids);
      delete from tt_files where org_id = p_org and entity_type = 'task' and entity_id = any(ids);
      delete from tt_tasks where id = any(ids);
      n := cardinality(ids);
    end if;
  elsif p_kind = 'activity' then
    delete from tt_activity_logs where org_id = p_org and (p_ids is null or id = any(p_ids)); get diagnostics n = row_count;
  elsif p_kind = 'notifications' then
    delete from tt_notifications where org_id = p_org and (p_ids is null or id = any(p_ids)); get diagnostics n = row_count;
  elsif p_kind = 'emails' then
    delete from tt_email_delivery_logs where org_id = p_org and (p_ids is null or id = any(p_ids)); get diagnostics n = row_count;
  elsif p_kind = 'templates' then
    delete from tt_task_templates where org_id = p_org and (p_ids is null or id = any(p_ids)); get diagnostics n = row_count;
  elsif p_kind = 'departments' then
    -- tasks keep existing with no department; people stay in the organization
    delete from tt_departments where org_id = p_org and (p_ids is null or id = any(p_ids)); get diagnostics n = row_count;
  else raise exception 'Unknown kind of data: %', p_kind;
  end if;
  if n > 0 then
    insert into tt_activity_logs(org_id, actor_id, entity_type, entity_id, action, detail)
    values (p_org, auth.uid(), 'organization', p_org, 'data_deleted', jsonb_build_object('kind', p_kind, 'count', n, 'all', p_ids is null));
  end if;
  return jsonb_build_object('deleted', n, 'files', to_jsonb(paths));
end $$;
revoke execute on function tt_platform_delete(uuid, text, uuid[]) from public, anon;
grant execute on function tt_platform_delete(uuid, text, uuid[]) to authenticated;

notify pgrst, 'reload schema';
