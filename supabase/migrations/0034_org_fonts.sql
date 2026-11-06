-- REVIEW BEFORE APPLYING. Run after 0033.
-- Each organization can pick its font family and font style (admins only, through the existing org_update policy).
-- Null means the defaults: Fabric Grotesk, expressive (italic page titles and big numbers).

alter table tt_organizations add column if not exists font_family text;
alter table tt_organizations add column if not exists font_style text;
alter table tt_organizations drop constraint if exists tt_organizations_font_family_chk;
alter table tt_organizations add constraint tt_organizations_font_family_chk
  check (font_family is null or font_family in ('fabric', 'jakarta', 'system'));
alter table tt_organizations drop constraint if exists tt_organizations_font_style_chk;
alter table tt_organizations add constraint tt_organizations_font_style_chk
  check (font_style is null or font_style in ('expressive', 'classic'));
