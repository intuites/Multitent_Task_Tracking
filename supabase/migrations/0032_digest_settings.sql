-- Digest emails, set per organization in Organization settings. Times are in the organization's time zone.
-- Defaults match the 9:00-18:00 New York workday: midday at 13:30, end of day 10 minutes before close. Safe to run more than once.
alter table tt_organizations add column if not exists digest_midday_on boolean not null default true;
alter table tt_organizations add column if not exists digest_midday time not null default '13:30';
alter table tt_organizations add column if not exists digest_eod_on boolean not null default true;
alter table tt_organizations add column if not exists digest_eod time not null default '17:50';
alter table tt_organizations add column if not exists digest_days text not null default 'daily';
alter table tt_organizations add column if not exists digest_leads boolean not null default true;
alter table tt_organizations add column if not exists digest_extra_emails text[] not null default '{}';

alter table tt_organizations drop constraint if exists tt_organizations_digest_days_check;
alter table tt_organizations add constraint tt_organizations_digest_days_check check (digest_days in ('daily', 'weekdays'));
alter table tt_organizations drop constraint if exists tt_organizations_digest_order_check;
alter table tt_organizations add constraint tt_organizations_digest_order_check
  check (not (digest_midday_on and digest_eod_on) or digest_midday < digest_eod);
alter table tt_organizations drop constraint if exists tt_organizations_digest_extra_check;
alter table tt_organizations add constraint tt_organizations_digest_extra_check check (cardinality(digest_extra_emails) <= 20);
