-- REVIEW BEFORE APPLYING. Run after 0034. Safe to run more than once.
-- 1. Usernames: optional, unique; people sign in with their username or their primary (sign-in) email.
-- 2. Extra email addresses per person per organization (never anyone's sign-in email, never twice in one organization).
-- 3. Each task assignment can send its emails to one of the person's addresses (empty = the primary).

-- ───────── 1. usernames (stored lower case; the sign-in endpoint looks them up with the service key)
alter table tt_profiles add column if not exists username text;
alter table tt_profiles drop constraint if exists tt_profiles_username_chk;
alter table tt_profiles add constraint tt_profiles_username_chk check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,29}$');
create unique index if not exists tt_profiles_username_uq on tt_profiles(username);

-- ───────── 2. extra email addresses
create table if not exists tt_member_emails (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tt_organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null check (length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  label text check (label is null or length(label) <= 40),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists tt_member_emails_uq on tt_member_emails(org_id, email);
create index if not exists tt_member_emails_user on tt_member_emails(user_id, org_id);
alter table tt_member_emails enable row level security;

-- the person themselves, or an admin of that organization (platform admins count as owner through tt_role)
drop policy if exists member_emails_read on tt_member_emails;
create policy member_emails_read on tt_member_emails for select to authenticated
  using ((user_id = auth.uid() and tt_role(org_id) is not null) or tt_role(org_id) in ('owner', 'admin'));
drop policy if exists member_emails_insert on tt_member_emails;
create policy member_emails_insert on tt_member_emails for insert to authenticated
  with check ((user_id = auth.uid() and tt_role(org_id) is not null) or tt_role(org_id) in ('owner', 'admin'));
drop policy if exists member_emails_delete on tt_member_emails;
create policy member_emails_delete on tt_member_emails for delete to authenticated
  using ((user_id = auth.uid() and tt_role(org_id) is not null) or tt_role(org_id) in ('owner', 'admin'));
grant select, insert, delete on tt_member_emails to authenticated;

-- lower case, the person must belong to the organization, and no sign-in email of any account
create or replace function tt_member_email_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.email := lower(trim(new.email));
  new.label := nullif(trim(new.label), '');
  if not exists (select 1 from tt_org_members where org_id = new.org_id and user_id = new.user_id) then
    raise exception 'That person is not in this organization';
  end if;
  if exists (select 1 from auth.users where lower(email) = new.email) then
    raise exception 'This email is already used to sign in to Taskify, so it can''t be an extra address';
  end if;
  return new;
end $$;
drop trigger if exists tt_member_email_guard_trg on tt_member_emails;
create trigger tt_member_email_guard_trg before insert or update on tt_member_emails for each row execute function tt_member_email_guard();

-- a removed address stops getting task emails: those tasks go back to the primary
create or replace function tt_member_email_cleanup() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update tt_task_assignees a set email = null from tt_tasks t
  where t.id = a.task_id and t.org_id = old.org_id and a.user_id = old.user_id and a.email = old.email;
  return old;
end $$;
drop trigger if exists tt_member_email_cleanup_trg on tt_member_emails;
create trigger tt_member_email_cleanup_trg after delete on tt_member_emails for each row execute function tt_member_email_cleanup();

-- ───────── 3. which address each assignment emails (null = primary)
alter table tt_task_assignees add column if not exists email text;

-- same as 0004, plus p_email: the person's primary or one of their extra addresses here.
-- Assigning someone already assigned just changes the address (the new address gets the "assigned" email).
drop function if exists tt_assign(uuid, uuid, boolean);
create or replace function tt_assign(p_task uuid, p_user uuid, p_add boolean default true, p_email text default null) returns void
language plpgsql security definer set search_path = public as $$
declare t tt_tasks; em text := nullif(lower(trim(p_email)), '');
begin
  select * into t from tt_tasks where id = p_task;
  if not found then raise exception 'Task not found'; end if;
  if tt_role(t.org_id) not in ('owner','admin','manager') then raise exception 'Not authorized'; end if;
  if not exists (select 1 from tt_org_members where org_id = t.org_id and user_id = p_user and active) then
    raise exception 'User is not an active member of this organization';
  end if;
  if em is not null then
    if em = (select lower(email) from auth.users where id = p_user) then em := null;
    elsif not exists (select 1 from tt_member_emails where org_id = t.org_id and user_id = p_user and email = em) then
      raise exception 'That email isn''t one of this person''s addresses';
    end if;
  end if;
  if p_add then
    insert into tt_task_assignees(task_id, user_id, assigned_by, email) values (p_task, p_user, auth.uid(), em)
      on conflict (task_id, user_id) do update set email = excluded.email;
    if p_user <> auth.uid() then perform tt_notify(t.org_id, p_user, 'task_assigned', 'You were assigned: ' || t.title, null, '/tasks/' || p_task,
      'assign:' || p_task || ':' || p_user || coalesce(':' || em, '')); end if;
  else
    delete from tt_task_assignees where task_id = p_task and user_id = p_user;
    if p_user <> auth.uid() then perform tt_notify(t.org_id, p_user, 'task_assignment_changed', 'You were unassigned from: ' || t.title, null, '/tasks/' || p_task, null); end if;
  end if;
  perform tt_log(t.org_id, 'task', p_task, case when p_add then 'assignee_added' else 'assignee_removed' end, jsonb_build_object('user', p_user, 'email', em));
end $$;

-- same as 0031, except task emails go to the address chosen for that assignment
create or replace function tt_notify(p_org uuid, p_user uuid, p_type text, p_title text, p_body text, p_link text, p_dedup text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_in_app boolean; v_email boolean; em text;
begin
  select in_app, email into v_in_app, v_email from tt_notification_preferences where user_id = p_user and org_id = p_org and type = p_type;
  if not found then v_in_app := true; v_email := true; end if;
  if v_in_app then
    insert into tt_notifications(org_id, user_id, type, title, body, link, dedup_key)
    values (p_org, p_user, p_type, p_title, p_body, p_link, p_dedup) on conflict (user_id, dedup_key) do nothing;
  end if;
  if v_email then
    if p_link ~ '^/tasks/[0-9a-fA-F-]{36}$' then
      select a.email into em from tt_task_assignees a where a.task_id = substr(p_link, 8)::uuid and a.user_id = p_user;
    end if;
    if em is null then select email into em from tt_profiles where user_id = p_user; end if;
    if em is not null then
      insert into tt_email_delivery_logs(org_id, user_id, to_email, subject, body, dedup_key, kind, link)
      values (p_org, p_user, em, p_title, coalesce(p_body, p_title), p_dedup, p_type, p_link) on conflict (user_id, dedup_key) do nothing;
    end if;
  end if;
end $$;
revoke execute on function tt_notify(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
