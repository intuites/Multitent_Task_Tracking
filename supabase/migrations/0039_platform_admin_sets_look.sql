-- REVIEW BEFORE APPLYING. Run after 0036. Safe to run more than once.
-- Platform admins can set anyone's appearance (theme, color, font, italic, text size) from that person's page.
-- Only the appearance keys of tt_profiles.prefs change; everything else in prefs (like the tour) stays.

create or replace function tt_platform_set_look(p_user uuid, p_look jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v jsonb := '{}'::jsonb;
begin
  if not tt_is_platform_admin() then raise exception 'Only platform admins can change someone else''s appearance'; end if;
  if not exists (select 1 from tt_profiles where user_id = p_user) then raise exception 'No such person'; end if;
  if p_look ? 'color' then
    if p_look->>'color' !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Color must look like #1A2B3C'; end if;
    v := v || jsonb_build_object('color', lower(p_look->>'color'));
  end if;
  if p_look ? 'font' then
    if p_look->>'font' not in ('fabric','jakarta','lora') then raise exception 'Unknown font'; end if;
    v := v || jsonb_build_object('font', p_look->>'font');
  end if;
  if p_look ? 'style' then
    if p_look->>'style' not in ('classic','expressive') then raise exception 'Unknown font style'; end if;
    v := v || jsonb_build_object('style', p_look->>'style');
  end if;
  if p_look ? 'size' then
    if p_look->>'size' not in ('compact','normal','large') then raise exception 'Unknown text size'; end if;
    v := v || jsonb_build_object('size', p_look->>'size');
  end if;
  if p_look ? 'theme' then
    if p_look->>'theme' not in ('dark','light','system') then raise exception 'Unknown theme'; end if;
    v := v || jsonb_build_object('theme', p_look->>'theme');
  end if;
  update tt_profiles set prefs = coalesce(prefs, '{}'::jsonb) || v where user_id = p_user;
end $$;

revoke execute on function tt_platform_set_look(uuid, jsonb) from public, anon;
grant execute on function tt_platform_set_look(uuid, jsonb) to authenticated;
