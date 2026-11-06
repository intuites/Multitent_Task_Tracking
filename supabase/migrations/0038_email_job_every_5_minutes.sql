-- REVIEW BEFORE APPLYING. Run after 0037. Safe to run more than once.
-- Runs Taskify's job (/api/cron/tick: reminders, digests, recurring tasks, sending queued emails) every 5 minutes
-- from Supabase itself. Vercel's free plan only allows a daily schedule, which is why emails were hours late.
--
-- BEFORE RUNNING: replace PASTE_CRON_SECRET_HERE below with the CRON_SECRET value from Vercel
-- (Project → Settings → Environment Variables). It is stored encrypted in Supabase Vault, not in this file or the repo.
-- To change it later: select vault.update_secret((select id from vault.secrets where name = 'tt_cron_secret'), '<new value>');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('PASTE_CRON_SECRET_HERE', 'tt_cron_secret', 'Taskify: CRON_SECRET for the email job')
where not exists (select 1 from vault.secrets where name = 'tt_cron_secret');

select cron.unschedule(jobid) from cron.job where jobname = 'taskify-tick';
select cron.schedule('taskify-tick', '*/5 * * * *', $job$
  select net.http_get(
    url := 'https://multitent-task-tracking.vercel.app/api/cron/tick',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'tt_cron_secret')),
    timeout_milliseconds := 60000
  );
$job$);

-- Check it a few minutes later: 200 means it ran; 401 means the secret doesn't match Vercel's CRON_SECRET.
-- select status_code, left(content, 300), created from net._http_response order by created desc limit 5;
