-- REVIEW BEFORE APPLYING. Run after 0022.
-- Inside an organization there are now only two roles: admin and employee. Platform admin sits outside every organization.
-- Existing managers become admins, so they keep creating and assigning tasks.
-- (Older functions still list 'manager' in their allowed-role arrays; with no managers left that is harmless.)

update tt_org_members set role = 'admin' where role = 'manager';
alter table tt_org_members drop constraint if exists tt_org_members_role_check;
alter table tt_org_members add constraint tt_org_members_role_check check (role in ('admin','employee'));
