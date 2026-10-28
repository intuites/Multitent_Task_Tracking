# API

Most data access is Supabase (PostgREST + RPC) under RLS. Custom HTTP endpoints (all JSON, errors as `{ "error": "..." }`):

## POST /api/invite
Header `Authorization: Bearer <user JWT>`. Body: `{ org_id, email, full_name?, role }` (employee) or `{ org_id, email, full_name?, client_contact_id }` (portal).
Caller's role is read from `org_members`. Employee invites: owner/admin (only an owner can invite owners). Portal invites: manager+. 401/403/400/404/405 as appropriate.

## GET /api/cron/tick
Header `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends this automatically when `CRON_SECRET` is set). Runs `tt_generate_recurrences(100)`, `tt_generate_reminders(500)`, then sends up to 50 queued emails. Returns counts. Safe to call repeatedly.

## RPC (called via `supabase.rpc`)
`tt_create_organization(p_name,p_slug,p_tz)`, `tt_set_task_status(p_task,p_to,p_reason,p_override)`, `tt_assign(p_task,p_user,p_add)`, `tt_add_dependency(p_task,p_blocker)`, `tt_raise_escalation(...)`, `tt_escalation_update(p_esc,p_state,p_note,p_owner)`, `tt_resolve_escalation(p_esc,p_next_status,p_resolution)`, `tt_request_approval`, `tt_decide_approval`, `tt_set_recurrence`, `tt_portal_submit_request`, `tt_portal_update_contact`, `tt_is_platform_admin`, `tt_platform_stats`.

CSV export is generated in the browser from RLS-filtered data.
