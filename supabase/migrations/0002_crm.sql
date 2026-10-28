-- REVIEW BEFORE APPLYING. Additive only. CRM: extra client fields, contacts, notes, activity log.

alter table clients add column if not exists industry text;
alter table clients add column if not exists website text;
alter table clients add column if not exists address text;
alter table clients add column if not exists source text;
alter table clients add column if not exists tags text[] not null default '{}';

create table if not exists client_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  full_name text not null,
  job_title text,
  email text,
  phone text,
  department text,
  is_primary boolean not null default false,
  is_billing boolean not null default false,
  can_approve boolean not null default false,
  portal_access boolean not null default false,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now()
);
comment on table client_contacts is 'People at a client. portal_access/can_approve gate the client portal (Phase 9).';
create index if not exists client_contacts_client on client_contacts(client_id);
-- at most one primary contact per client
create unique index if not exists client_contacts_one_primary on client_contacts(client_id) where is_primary;

create table if not exists client_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  body text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
comment on table client_notes is 'Internal-only notes. Never exposed to the client portal.';
create index if not exists client_notes_client on client_notes(client_id, created_at desc);

create table if not exists tt_activity_logs (
  id bigserial primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  actor_id uuid references auth.users(id),
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
comment on table tt_activity_logs is 'Tenant-scoped audit trail. Do not store secrets or tokens in detail.';
create index if not exists tt_activity_entity on tt_activity_logs(org_id, entity_type, entity_id, created_at desc);

alter table client_contacts enable row level security;
alter table client_notes enable row level security;
alter table tt_activity_logs enable row level security;

create policy contacts_read on client_contacts for select using (is_org_member(org_id));
create policy contacts_write on client_contacts for all
  using (is_org_member(org_id, array['owner','admin','manager']))
  with check (is_org_member(org_id, array['owner','admin','manager']));

create policy notes_read on client_notes for select using (is_org_member(org_id));
create policy notes_write on client_notes for all
  using (is_org_member(org_id, array['owner','admin','manager']))
  with check (is_org_member(org_id, array['owner','admin','manager']));

create policy activity_read on tt_activity_logs for select using (is_org_member(org_id));
-- members may only append entries attributed to themselves; no update/delete policy = immutable
create policy activity_insert on tt_activity_logs for insert
  with check (is_org_member(org_id) and actor_id = auth.uid());
