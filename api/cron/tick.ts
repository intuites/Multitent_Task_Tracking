import { timingSafeEqual } from 'node:crypto';
// .js extensions: Vercel runs each api file as plain Node ESM, which needs them
import { admin, handler, HttpError } from '../_lib/http.js';
import { sendEmail } from '../_lib/email.js';
import { queueDigests, render } from '../_lib/taskEmails.js';
import type { Ctx } from '../_lib/emailTemplates.js';

const MAX_ATTEMPTS = 5;
const EMAIL_BATCH = 50;

// Vercel Cron sends "Authorization: Bearer $CRON_SECRET". Safe to retry: every step is idempotent.
export default handler('GET', async (req) => {
  const secret = process.env.CRON_SECRET;
  const h = req.headers.authorization;
  const given = typeof h === 'string' ? h : '';
  const want = `Bearer ${secret}`;
  if (!secret || given.length !== want.length || !timingSafeEqual(Buffer.from(given), Buffer.from(want))) throw new HttpError(401, 'Unauthorized');

  const started = Date.now();
  const db = admin();
  const rec = await db.rpc('tt_generate_recurrences', { p_limit: 100 });
  const rem = await db.rpc('tt_generate_reminders', { p_limit: 500 });
  const taskRem = await db.rpc('tt_generate_task_reminders', { p_limit: 500 });

  // midday / end-of-day digests are queued like any other email (once per organization, person and day)
  const digests = await queueDigests(db).catch((e: Error) => `error: ${e.message}`);

  // select('*'): kind, link and html arrive with migration 0031; before it, rows still send in the plain layout
  const { data: queue } = await db.from('tt_email_delivery_logs').select('*')
    .in('status', ['pending', 'failed']).lt('attempts', MAX_ATTEMPTS).order('created_at').limit(EMAIL_BATCH);
  let sent = 0, failed = 0;
  const orgs = new Map<string, Ctx>();
  const send = async (m: any) => {
    // claim the row (optimistic lock on attempts) so overlapping ticks cannot double-send
    const { data: claimed } = await db.from('tt_email_delivery_logs').update({ attempts: m.attempts + 1 })
      .eq('id', m.id).eq('attempts', m.attempts).in('status', ['pending', 'failed']).select('id');
    if (!claimed?.length) return;
    const mail = m.html ? { subject: m.subject, text: m.body ?? m.subject, html: m.html }
      : await render(db, m, orgs).catch(() => ({ subject: m.subject, text: `${m.body ?? m.subject}\n\n${process.env.APP_URL || ''}`, html: undefined }));
    const r = await sendEmail(m.to_email, mail.subject, mail.text, mail.html);
    if (r.ok) {
      sent++;
      await db.from('tt_email_delivery_logs').update({ status: 'sent', sent_at: new Date().toISOString(), provider_message_id: r.id, last_error: null }).eq('id', m.id);
    } else {
      failed++;
      await db.from('tt_email_delivery_logs').update({ status: 'failed', last_error: r.error }).eq('id', m.id);
    }
  };
  // 4 at a time; no new email starts after 45 s, so the run ends inside Vercel's 60 s limit and the rest go next run
  const todo = [...(queue ?? [])];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (todo.length && Date.now() - started < 45_000) await send(todo.shift());
  }));
  return {
    recurrences: rec.error ? `error: ${rec.error.message}` : rec.data,
    reminders: rem.error ? `error: ${rem.error.message}` : rem.data,
    task_reminders: taskRem.error ? `error: ${taskRem.error.message}` : taskRem.data,
    digests,
    emails: { sent, failed, left_for_next_run: todo.length },
  };
});
