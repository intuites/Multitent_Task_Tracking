import { timingSafeEqual } from 'node:crypto';
import { admin, handler, HttpError } from '../_lib/http';
import { sendEmail } from '../_lib/email';

const MAX_ATTEMPTS = 5;
const EMAIL_BATCH = 50;

// Vercel Cron sends "Authorization: Bearer $CRON_SECRET". Safe to retry: every step is idempotent.
export default handler('GET', async (req) => {
  const secret = process.env.CRON_SECRET;
  const h = req.headers.authorization;
  const given = typeof h === 'string' ? h : '';
  const want = `Bearer ${secret}`;
  if (!secret || given.length !== want.length || !timingSafeEqual(Buffer.from(given), Buffer.from(want))) throw new HttpError(401, 'Unauthorized');

  const db = admin();
  const rec = await db.rpc('tt_generate_recurrences', { p_limit: 100 });
  const rem = await db.rpc('tt_generate_reminders', { p_limit: 500 });
  const taskRem = await db.rpc('tt_generate_task_reminders', { p_limit: 500 });

  const { data: queue } = await db.from('tt_email_delivery_logs').select('id, to_email, subject, body, attempts')
    .in('status', ['pending', 'failed']).lt('attempts', MAX_ATTEMPTS).order('created_at').limit(EMAIL_BATCH);
  let sent = 0, failed = 0;
  for (const m of queue ?? []) {
    // claim the row (optimistic lock on attempts) so overlapping ticks cannot double-send
    const { data: claimed } = await db.from('tt_email_delivery_logs').update({ attempts: m.attempts + 1 })
      .eq('id', m.id).eq('attempts', m.attempts).in('status', ['pending', 'failed']).select('id');
    if (!claimed?.length) continue;
    const r = await sendEmail(m.to_email, m.subject, `${m.body}\n\n${process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || ''}`);
    if (r.ok) {
      sent++;
      await db.from('tt_email_delivery_logs').update({ status: 'sent', sent_at: new Date().toISOString(), provider_message_id: r.id, last_error: null }).eq('id', m.id);
    } else {
      failed++;
      await db.from('tt_email_delivery_logs').update({ status: 'failed', last_error: r.error }).eq('id', m.id);
    }
  }
  return {
    recurrences: rec.error ? `error: ${rec.error.message}` : rec.data,
    reminders: rem.error ? `error: ${rem.error.message}` : rem.data,
    task_reminders: taskRem.error ? `error: ${taskRem.error.message}` : taskRem.data,
    emails: { sent, failed },
  };
});
