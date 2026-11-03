-- REVIEW BEFORE APPLYING. Run after 0028.
-- Each organization can pick its own brand color (admins only, through the existing org_update policy).
-- Null means the default Taskify green. The app derives light- and dark-mode shades from this one color.

alter table tt_organizations add column if not exists brand_color text;
alter table tt_organizations drop constraint if exists tt_organizations_brand_color_chk;
alter table tt_organizations add constraint tt_organizations_brand_color_chk
  check (brand_color is null or brand_color ~ '^#[0-9a-fA-F]{6}$');
