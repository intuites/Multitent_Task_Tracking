-- REVIEW BEFORE APPLYING. Run after 0040. Safe to run more than once.
-- Platform admins can delete any user's account (Admin site > All users, or a person's page). Deleting an account
-- used to fail, because many columns point to auth.users with no rule for what happens when the account goes.
-- From now on deleting an account removes everything that is that person's:
--   - rows that only make sense with them (comments they wrote, their assignments and watches, their activity
--     log entries and status changes, memberships, profile, extra emails, notifications) are deleted;
--   - shared records they only touched (tasks they created or completed, files they uploaded, organizations they
--     created) stay, with that column emptied.
-- Done generically: every foreign key in public to auth.users that has no delete rule gets one.

do $$
declare r record; act text;
begin
  for r in
    select c.conname, t.relname, a.attname, a.attnotnull
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and n.nspname = 'public'
      and c.confdeltype = 'a' -- 'a' = no action: no rule yet
  loop
    act := case when r.attnotnull or (r.relname, r.attname) in (('tt_activity_logs', 'actor_id'), ('tt_task_status_history', 'changed_by'))
                then 'cascade' else 'set null' end;
    execute format('alter table public.%I drop constraint %I, add constraint %I foreign key (%I) references auth.users(id) on delete %s',
      r.relname, r.conname, r.conname, r.attname, act);
  end loop;
end $$;

-- Check: every link to auth.users and its rule (c = delete with the account, n = empty the column). None should say 'a'.
-- select t.relname, a.attname, c.confdeltype from pg_constraint c join pg_class t on t.oid = c.conrelid
--   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
--   where c.contype = 'f' and c.confrelid = 'auth.users'::regclass order by 1;
