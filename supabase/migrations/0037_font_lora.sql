-- REVIEW BEFORE APPLYING. Run after 0036. Safe to run more than once.
-- Organizations can pick Lora as their font (personal choices in tt_profiles.prefs need no change).

alter table tt_organizations drop constraint if exists tt_organizations_font_family_chk;
alter table tt_organizations add constraint tt_organizations_font_family_chk
  check (font_family is null or font_family in ('fabric', 'jakarta', 'lora', 'system'));
