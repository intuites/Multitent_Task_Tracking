// Sends queued email rows (tt_email_delivery_logs). Used by the scheduled job and by the instant send after task actions.
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from './email.js';
import { render } from './taskEmails.js';
import type { Ctx } from './emailTemplates.js';

/** Sends `rows` 4 at a time until `budgetMs` runs out; each row is claimed first, so overlapping runs never send one twice. */
export async function sendQueued(db: SupabaseClient, rows: any[], budgetMs: number) {
  const started = Date.now();
  let sent = 0, failed = 0;
  const orgs = new Map<string, Ctx>();
  const send = async (m: any) => {
    // claim the row (optimistic lock on attempts)
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
  const todo = [...rows];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (todo.length && Date.now() - started < budgetMs) await send(todo.shift());
  }));
  return { sent, failed, left_for_next_run: todo.length };
}
