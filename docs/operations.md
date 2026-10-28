# Operations

- **Run locally**: fill `.env.local`, `npm install`, `npm run dev` (UI + `/api`). Trigger cron manually: `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:5173/api/cron/tick`.
- **First setup**: sign up → "Set up your organization" screen creates the org with you as owner. Platform admin: insert your user id into `tt_platform_admins` via SQL.
- **Portal user**: Contacts → "Invite to portal" (needs contact email); they sign in and see the portal automatically.
- **Monitoring**: `select status, count(*) from tt_email_delivery_logs group by 1;` — rows stuck `failed` with attempts=5 need provider fixes, then `update … set attempts=0`.
- **Cron limits**: each tick is bounded (100 recurrences, 500 reminders, 50 emails). Reminders are deduplicated per user/day so reruns are safe; with >500 due items per tick the most urgent are processed first.
- **Recurrence semantics**: custom = every N days; missed slots collapse into a single latest occurrence; times follow the org time zone.
- **Backups**: rely on Supabase backups; migrations never drop data.
