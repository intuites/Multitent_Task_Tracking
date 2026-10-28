# Testing

## Automated (run: `npm test`, `npm run build`)
Executed and passing at time of writing: 14 unit tests — permission matrix, status transitions, default status, cycle detection, project progress rules, cron auth (401/405), invite auth, email unconfigured behaviour. `npm run build` (tsc + vite) passes.

## NOT yet executed (need a live Supabase with migrations applied)
Run these manually with two orgs (A, B) and users of each role:
1. User in org B selects org A rows from `clients`, `tt_tasks`, `tt_files`, `tt_notifications` → expect 0 rows; update/delete → 0 rows affected.
2. Employee cannot insert clients/tasks; cannot `update tt_tasks set status=...` (trigger error); can call `tt_set_task_status` only on assigned tasks.
3. New task has status `not_yet_started` even if insert supplies another; a history row exists.
4. `tt_add_dependency` A→B then B→A is rejected; starting a task with open blockers is rejected unless manager override.
5. Raise escalation → task `escalation`, `previous_task_status` kept; `tt_resolve_escalation` without next status fails; with `in_progress` task moves there, never auto-completed.
6. Portal user: sees only `client_visible` tasks/projects of own client, only `visibility='client'` comments, cannot read escalations/notes/other clients; cannot call `tt_decide_approval` unless `can_approve`.
7. Storage: portal user downloads only files whose `tt_files` row is visible to them.
8. Call `select tt_generate_recurrences()` twice → second call creates nothing; reminders twice → no duplicate notifications.
9. `anon`/`authenticated` calling `tt_generate_recurrences` or `tt_notify` → permission denied.

Candidate Dashboard regression tests cannot be written until its source/schema is provided.
