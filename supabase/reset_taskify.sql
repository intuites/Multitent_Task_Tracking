-- DESTRUCTIVE: deletes all Taskify data (organizations, clients, projects, tasks, comments, notifications...).
-- Drops ONLY objects created by Taskify's migrations; other tables in the database are not touched.
-- Auth users (logins) are kept. Files already in the 'tt-files' storage bucket are kept (Supabase blocks
-- deleting storage rows from SQL); remove them in Dashboard > Storage if you want a clean bucket.
-- After running this, run supabase/migrations/0001 ... 0013 in order.

begin;

-- storage policies created by 0004/0005
drop policy if exists tt_files_member_read on storage.objects;
drop policy if exists tt_files_member_insert on storage.objects;
drop policy if exists tt_files_member_delete on storage.objects;
drop policy if exists tt_files_portal_read on storage.objects;
drop policy if exists tt_files_portal_insert on storage.objects;
drop policy if exists tt_avatars_read on storage.objects;
drop policy if exists tt_avatars_write on storage.objects;
drop policy if exists tt_avatars_update on storage.objects;
drop policy if exists tt_avatars_delete on storage.objects;

-- trigger on auth.users that fills tt_profiles
drop trigger if exists tt_on_auth_user_created on auth.users;

-- tables: old un-prefixed names and the tt_ ones (CASCADE removes their policies, triggers and FKs)
drop table if exists
  tt_task_templates, tt_task_comment_edits, tt_task_comments, tt_task_checklist_items, tt_task_dependencies, tt_task_watchers,
  tt_task_assignees, tt_task_status_history, tt_task_recurrence, tt_approvals, tt_escalation_updates, tt_escalations,
  tt_files, tt_notifications, tt_notification_preferences, tt_email_delivery_logs, tt_activity_logs,
  tt_project_members, tt_project_milestones, tt_team_members, tt_teams, tt_departments, tt_tasks,
  tt_platform_admins, tt_profiles,
  tt_client_notes, tt_client_contacts, tt_projects, tt_clients, tt_org_members, tt_organizations,
  client_notes, client_contacts, projects, clients, org_members, organizations
cascade;

-- functions (both the old and the renamed helper)
drop function if exists
  is_org_member, tt_is_org_member, tt_role, tt_log, tt_notify, tt_handle_new_user, tt_tasks_guard, tt_tasks_created,
  tt_task_participants, tt_comment_before, tt_comment_after, tt_transition_ok, tt_set_task_status, tt_assign,
  tt_add_dependency, tt_raise_escalation, tt_escalation_update, tt_resolve_escalation, tt_request_approval,
  tt_decide_approval, tt_create_organization, tt_members_guard, tt_next_run, tt_set_recurrence,
  tt_generate_recurrences, tt_generate_reminders, tt_portal_client_ids, tt_portal_task_visible,
  tt_portal_project_visible, tt_portal_submit_request, tt_portal_update_contact, tt_is_platform_admin,
  tt_platform_stats, tt_org_summary, tt_leave_org, tt_clients_parent_guard, tt_create_from_template,
  tt_subtasks_done_guard, tt_generate_task_reminders, tt_task_cc_emails, tt_notify_assignee_leads
cascade;

commit;
