-- REVIEW BEFORE APPLYING. Run after 0045. Safe to run more than once.
-- An invited person showed up as an active member straight away, before they opened the invitation or chose a
-- password. Now an invitation is a waiting membership (active = false, joined_at null): not in people lists, can't
-- be assigned, gets no emails, can't open the organization. It switches on when they have set their password
-- (tt_accept_invites, called after the password page and on every sign-in).

alter table tt_org_members add column if not exists joined_at timestamptz;

-- existing rows: people with a password have joined; invited people who never set one go back to waiting
select set_config('tt.rpc', 'on', false);
update tt_org_members m set joined_at = coalesce(m.joined_at, m.created_at)
  from auth.users u where u.id = m.user_id and coalesce(u.encrypted_password, '') <> '' and m.joined_at is null;
update tt_org_members m set active = false
  from auth.users u where u.id = m.user_id and coalesce(u.encrypted_password, '') = '' and m.joined_at is null and m.active;
select set_config('tt.rpc', '', false);
-- everyone added any other way (creating an organization, a platform admin sent back) has joined at once;
-- only the invite API leaves it empty
alter table tt_org_members alter column joined_at set default now();

-- a waiting invitation can't be switched on by hand: only by the person setting their password
create or replace function tt_members_pending_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null or coalesce(current_setting('tt.rpc', true), '') = 'on' then return new; end if;
  if new.active and new.joined_at is null then
    raise exception 'They haven''t accepted the invitation yet. They join once they open the email and set a password.';
  end if;
  if new.joined_at is distinct from old.joined_at then raise exception 'Only the invited person can accept an invitation'; end if;
  return new;
end $$;
drop trigger if exists tt_members_pending_guard_trg on tt_org_members;
create trigger tt_members_pending_guard_trg before update on tt_org_members for each row execute function tt_members_pending_guard();

-- the signed-in person accepts their waiting invitations once their account has a password
create or replace function tt_accept_invites() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then return 0; end if;
  if coalesce((select encrypted_password from auth.users where id = auth.uid()), '') = '' then return 0; end if;
  perform set_config('tt.rpc', 'on', true);
  update tt_org_members set active = true, joined_at = now() where user_id = auth.uid() and joined_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function tt_accept_invites() from public, anon;
grant execute on function tt_accept_invites() to authenticated;
