-- REVIEW BEFORE APPLYING. Additive only. Aggregates for the dashboard and employee workload computed in SQL
-- (replaces fetching thousands of rows to the browser). SECURITY INVOKER: RLS still limits rows to the caller's org.

create or replace function tt_org_summary(p_org uuid, p_day_start timestamptz, p_day_end timestamptz) returns jsonb
language sql stable as $$
  with t as (
    select id, status, priority, due_date from tt_tasks where org_id = p_org and archived_at is null
  ), ot as (
    select * from t where status not in ('completed','cancelled')
  )
  select jsonb_build_object(
    'open',       (select count(*) from ot),
    'overdue',    (select count(*) from ot where due_date < now()),
    'due_today',  (select count(*) from ot where due_date >= p_day_start and due_date < p_day_end),
    'in_review',  (select count(*) from t where status = 'in_review'),
    'by_status',  (select coalesce(jsonb_object_agg(status, c), '{}') from (select status, count(*) c from ot group by 1) s),
    'by_priority',(select coalesce(jsonb_object_agg(priority, c), '{}') from (select priority, count(*) c from ot group by 1) s),
    'workload',   (select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'open', o, 'overdue', od, 'blocked', b)), '[]')
                   from (select a.user_id, count(*) o,
                                count(*) filter (where ot.due_date < now()) od,
                                count(*) filter (where ot.status = 'blocked') b
                         from ot join tt_task_assignees a on a.task_id = ot.id group by a.user_id) w)
  );
$$;
comment on function tt_org_summary is 'Dashboard/workload aggregates for one org. Day bounds are passed by the client so "today" matches the viewer.';
