# Security

- **Tenant isolation**: RLS on every table keyed by `org_id` through `is_org_member(org_id, roles[])`, which reads `org_members` using `auth.uid()`. Roles/org ids from the browser are never trusted; functions re-check.
- **Secrets**: `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `EMAIL_PROVIDER_API_KEY` are server-only (no `VITE_` prefix). Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` reach the browser. `.env.local` is git-ignored.
- **Status integrity**: trigger blocks direct status updates; history is written by functions.
- **Files**: private bucket, 10 MB limit and MIME allow-list on the bucket, signed URLs (60 s), org-scoped storage policies.
- **Cron**: constant-time secret comparison; DB functions revoked from `anon/authenticated`.
- **CSV export** neutralises spreadsheet formulas.
- **Errors**: API returns generic messages; details only in server logs.

## Known gaps
- No rate limiting on `/api/invite` (use Vercel firewall / add limiter).
- Email unsubscribe is per-user preferences in-app; no signed one-click unsubscribe link.
- RLS has not been exercised against a live database yet — run the checks in `testing.md`.
