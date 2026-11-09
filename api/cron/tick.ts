import { timingSafeEqual } from 'node:crypto';
// .js extensions: Vercel runs each api file as plain Node ESM, which needs them
import { admin, handler, HttpError } from '../_lib/http.js';
import { queueDigests } from '../_lib/taskEmails.js';
import { queuedRows, sendQueued } from '../_lib/sendQueue.js';

const MAX_ATTEMPTS = 5;
const EMAIL_BATCH = 50;

// Called every 5 minutes by Supabase (pg_cron, migration 0038) and daily by Vercel Cron, with "Authorization: Bearer $CRON_SECRET".
// Safe to retry or overlap: every step is idempotent.
export default handler('GET', async (req) => {
  const secret = process.env.CRON_SECRET;
  const h = req.headers.authorization;
  const given = typeof h === 'string' ? h : '';
  const a = Buffer.from(given), b = Buffer.from(`Bearer ${secret}`);
  // byte lengths: timingSafeEqual throws (a 500) on different lengths, which non-ASCII characters can cause
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, 'Unauthorized');

  const started = Date.now();
  const db = admin();
  const rec = await db.rpc('tt_generate_recurrences', { p_limit: 100 });
  const rem = await db.rpc('tt_generate_reminders', { p_limit: 500 });
  const taskRem = await db.rpc('tt_generate_task_reminders', { p_limit: 500 });

  // midday / end-of-day digests are queued like any other email (once per organization, person and day)
  const digests = await queueDigests(db).catch((e: Error) => `error: ${e.message}`);

  // select('*'): kind, link and html arrive with migration 0031; before it, rows still send in the plain layout
  const queue = await queuedRows(db, MAX_ATTEMPTS, EMAIL_BATCH);
  // no new email starts after 45 s in all, so the run ends inside Vercel's 60 s limit and the rest go next run
  const emails = await sendQueued(db, queue ?? [], 45_000 - (Date.now() - started));
  return {
    recurrences: rec.error ? `error: ${rec.error.message}` : rec.data,
    reminders: rem.error ? `error: ${rem.error.message}` : rem.data,
    task_reminders: taskRem.error ? `error: ${taskRem.error.message}` : taskRem.data,
    digests,
    emails,
  };
});
