# Email

Provider: Resend (swap `api/_lib/email.ts` for another). Env vars (server only): `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM` (verified sender), `APP_URL`.

Flow: events call `tt_notify` → in-app row + `tt_email_delivery_logs` row (`pending`) honouring each user's preferences → `/api/cron/tick` sends in batches of 50. A row becomes `sent` **only** if the provider returns 2xx with a message id; otherwise `failed` with `last_error` and is retried on later ticks up to 5 attempts. Without configuration, rows stay `failed` with "Email provider not configured" — nothing is reported as sent.

Dedup: unique `(user_id, dedup_key)` on both notifications and email logs.
Supabase Auth emails (invites, password reset) use the Supabase project's own SMTP settings, configured in the Supabase dashboard.
