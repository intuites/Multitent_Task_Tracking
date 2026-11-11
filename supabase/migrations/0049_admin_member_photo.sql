-- Admins and platform admins can add, change or remove a member's profile photo.
-- Who may: the person themselves; a platform admin; or an admin of an organization the person belongs to, as long as
-- the person is in no other organization (the same rule as tt_admin_update_profile, since a photo shows everywhere).

-- ───────── may the signed-in user manage this person's photo? (text in: storage folder names are text)
create or replace function tt_can_manage_photo(p_user text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare u uuid;
begin
  if p_user !~ '^[0-9a-fA-F-]{36}$' then return false; end if;
  u := p_user::uuid;
  if u = auth.uid() or tt_is_platform_admin() then return true; end if;
  return exists (
    select 1 from tt_org_members m
    where m.user_id = u and m.active and coalesce(tt_role(m.org_id), '') in ('owner', 'admin'))
    and not exists (
      select 1 from tt_org_members a join tt_org_members b on b.user_id = a.user_id and b.active and b.org_id <> a.org_id
      where a.user_id = u and a.active);
end $$;
revoke execute on function tt_can_manage_photo(text) from public, anon;
grant execute on function tt_can_manage_photo(text) to authenticated;

-- ───────── storage: the photo folder is named after the person; these replace the "own folder only" rules from 0010
drop policy if exists tt_avatars_write on storage.objects;
drop policy if exists tt_avatars_update on storage.objects;
drop policy if exists tt_avatars_delete on storage.objects;
create policy tt_avatars_write on storage.objects for insert to authenticated
  with check (bucket_id = 'tt-avatars' and public.tt_can_manage_photo((storage.foldername(name))[1]));
create policy tt_avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'tt-avatars' and public.tt_can_manage_photo((storage.foldername(name))[1]))
  with check (bucket_id = 'tt-avatars' and public.tt_can_manage_photo((storage.foldername(name))[1]));
create policy tt_avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'tt-avatars' and public.tt_can_manage_photo((storage.foldername(name))[1]));

-- ───────── set or clear someone else's photo; the address must be a file in that person's own photo folder
create or replace function tt_admin_set_photo(p_org uuid, p_user uuid, p_url text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user = auth.uid() then raise exception 'Change your own photo from your profile'; end if;
  if not tt_is_platform_admin() then
    if coalesce(tt_role(p_org), '') not in ('owner', 'admin') then raise exception 'Only admins can change someone''s photo'; end if;
    if not exists (select 1 from tt_org_members where org_id = p_org and user_id = p_user and active) then raise exception 'That person is not in this organization'; end if;
    if exists (select 1 from tt_org_members where user_id = p_user and active and org_id <> p_org) then
      raise exception 'This person also belongs to another organization, so only they or a platform admin can change their photo';
    end if;
  end if;
  if p_url is not null and p_url !~ ('/storage/v1/object/public/tt-avatars/' || p_user::text || '/[^/]+$') then
    raise exception 'That is not a photo uploaded for this person';
  end if;
  update tt_profiles set avatar_url = p_url, updated_at = now() where user_id = p_user;
  perform tt_log(p_org, 'member', p_user, case when p_url is null then 'photo_removed_by_admin' else 'photo_changed_by_admin' end, '{}'::jsonb);
end $$;
revoke execute on function tt_admin_set_photo(uuid, uuid, text) from public, anon;
grant execute on function tt_admin_set_photo(uuid, uuid, text) to authenticated;
