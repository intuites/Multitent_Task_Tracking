# Architecture

- **Frontend**: Vite + React + TypeScript (`src/`). Talks to Supabase directly with the **anon key** under the signed-in user's JWT; Row Level Security is the tenant boundary.
- **Workflow logic in Postgres**: state changes needing history/validation are `SECURITY DEFINER` functions (`tt_set_task_status`, `tt_assign`, `tt_add_dependency`, `tt_raise_escalation`, `tt_escalation_update`, `tt_resolve_escalation`, `tt_request_approval`, `tt_decide_approval`, `tt_set_recurrence`, `tt_create_organization`, portal RPCs). Each re-derives the caller's role from `org_members` via `auth.uid()`. A trigger (`tt_tasks_guard`) blocks direct `status` updates and forces new tasks to `not_yet_started`.
- **Serverless API** (`api/`, Vercel Functions shape, no `app.listen`): only what needs the service-role key — `POST /api/invite` (employee/portal invitations) and `GET /api/cron/tick` (recurrence, reminders, email sending). Shared helpers in `api/_lib/`.
- **Local dev**: `vite.config.ts` plugin serves `api/*.ts` at `/api/*` using `.env.local`; no Vercel CLI needed.
- **Storage**: private bucket `tt-files`, path `{org_id}/{entity}/{id}/{uuid}-{name}`; access is enforced by storage policies (org membership, or visibility of the matching `tt_files` row for portal users). Downloads use 60-second signed URLs.
- **Portal**: portal users are *not* in `org_members`; they are `client_contacts` rows with `user_id` + `portal_access`. Separate RLS policies expose only `client_visible` projects/tasks and `visibility='client'` comments/files.
- **Candidate Dashboard**: placeholder route `/candidates`. See `implementation-audit.md`.

Shared TypeScript (`api/_lib/permissions.ts`, `taskStatus.ts`, `progress.ts`) is used by both UI and API. The SQL transition matrix in `tt_transition_ok` mirrors `taskStatus.ts` — change both together.
