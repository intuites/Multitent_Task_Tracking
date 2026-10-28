-- Approvals and watching were removed from the app. Clear the approval gate so no existing task is stuck:
-- tt_set_task_status refuses to complete a task with requires_approval = true and no approved approval.
-- The tt_approvals / tt_task_watchers tables are left in place (unused) so no data is destroyed.
update tt_tasks set requires_approval = false where requires_approval;

-- Re-run the profile backfill so every login has a display name (fixes "Unknown" assignee names).
insert into tt_profiles(user_id, email, full_name)
select id, email, coalesce(raw_user_meta_data->>'full_name', split_part(email, '@', 1)) from auth.users
on conflict (user_id) do nothing;
