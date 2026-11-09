-- REVIEW BEFORE APPLYING. Run after 0042. Safe to run more than once.
-- Deleting a user failed with: relation "tt_platform_admins" does not exist.
-- Supabase deletes accounts from its own auth service, whose database session only looks in the "auth" schema.
-- The delete cascades into Taskify's tables, and their trigger functions (like the membership guard) name tables
-- without "public.", so they couldn't find them. Every function in public now always looks in public first.

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') -- skip functions owned by extensions
  loop
    execute format('alter function %s set search_path = public', f.sig);
  end loop;
end $$;
