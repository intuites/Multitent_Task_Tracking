# Vercel deployment (not performed yet)

1. Apply migrations 0001–0006 to Supabase (SQL editor or `supabase db push`) after review.
2. Vercel project: framework Vite, build `npm run build`, output `dist`. `vercel.json` already rewrites SPA routes (excluding `/api`) and defines one cron: `/api/cron/tick` hourly (`0 * * * *`). Hobby plans allow only daily crons — change the schedule accordingly.
3. Environment variables (Production + Preview): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `APP_URL`, `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM`.
4. Supabase Auth → URL configuration: add the Vercel URL to redirect URLs (invites/password reset).
5. Deploy; check `/api/cron/tick` returns 401 without the secret.

## Checklist to avoid disturbing the Candidate Dashboard
- Run migrations on a Supabase **branch/staging** first; compare against a schema dump.
- Confirm no name collisions (`organizations`, `clients`, `projects`, `org_members`, `client_contacts`).
- Deploy to a Preview URL; verify existing candidate flows before promoting.
