# Database dictionary

All tables have RLS enabled. `org_id` = tenant. Migrations: `supabase/migrations/0001..0006`, additive only (`if not exists`). **Review against your real schema before applying** (names like `organizations`, `clients`, `projects`, `org_members` may already exist there).

| Table | Purpose | Notes |
|---|---|---|
| organizations | Tenant root | name, slug (unique), time_zone |
| org_members | User role per org | roles owner/admin/manager/employee; `active` flag; owner changes guarded by trigger |
| tt_profiles | Display name/email per auth user | filled by trigger on `auth.users` |
| clients | CRM clients | type individual/business; status lead…archived |
| client_contacts | People at a client | `user_id` + `portal_access` + `can_approve` drive portal; one primary per client |
| client_notes | Internal notes | never exposed to portal |
| projects | Projects | `client_visible`, progress_mode manual/milestones/tasks |
| tt_project_milestones | Milestones | `completed_at` null = open |
| tt_project_members | Project team | table only; UI not built |
| tt_tasks | Tasks | status check constraint; trigger guards status; `archived_at`, `client_visible`, `requires_approval`, recurrence columns |
| tt_task_assignees | Many assignees | PK (task,user) prevents duplicates |
| tt_task_watchers | Watchers | separate from assignees |
| tt_task_status_history | Every transition | written by functions/trigger only |
| tt_task_checklist_items | Checklist | position for ordering |
| tt_task_dependencies | blocked-by edges | cycles rejected in `tt_add_dependency` |
| tt_task_comments / tt_task_comment_edits | Comments + edit audit | visibility internal/client; soft delete |
| tt_files | File metadata | bytes in storage bucket `tt-files` |
| tt_escalations / tt_escalation_updates | Escalation record + history | `previous_task_status`, `resolved_task_status` |
| tt_approvals | Approval requests | approver is a user or a client contact |
| tt_notifications / tt_notification_preferences | In-app notifications, per-type prefs | unique (user, dedup_key) |
| tt_email_delivery_logs | Email queue + log | status pending/sent/failed, attempts ≤5 |
| tt_task_recurrence | Recurrence rule per template task | unique (recurrence_parent_id, occurrence_date) on tasks gives idempotency |
| tt_departments / tt_teams / tt_team_members | Org structure | |
| tt_activity_logs | Audit trail | append-only (insert-own policy only) |
| tt_platform_admins | Platform super admins | no policies; manage with service role / SQL |

Key functions: see `architecture.md`. Cron-only (service_role execute): `tt_generate_recurrences`, `tt_generate_reminders`. Not callable by users: `tt_notify`, `tt_log`.

Migration 0006 adds `tt_org_summary(p_org, p_day_start, p_day_end)` (SECURITY INVOKER, so RLS applies): dashboard counts and employee workload are aggregated in SQL. The Reports page still aggregates up to 5,000 rows per table in the browser.
