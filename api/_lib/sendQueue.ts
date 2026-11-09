// Sends queued email rows (tt_email_delivery_logs). Used by the scheduled job and by the instant send after task actions.
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from './email.js';
import { render } from './taskEmails.js';
import type { Ctx } from './emailTemplates.js';

/** A row marked 'sending' longer than this was left by a run that died; it may be tried again. */
export const STALE_MS = 10 * 60e3;

/** The rows the scheduled job should try: new or failed ones, and ones a dead run left as 'sending'. */
export async function queuedRows(db: SupabaseClient, maxAttempts: number, limit: number) {
  const q = () => db.from('tt_email_delivery_logs').select('*').lt('attempts', maxAttempts).order('created_at').limit(limit);
  const r = await q().or(`status.in.(pending,failed),and(status.eq.sending,claimed_at.lt.${new Date(Date.now() - STALE_MS).toISOString()})`);
  // before migration 0040 there is no 'sending' status or claimed_at column
  return r.error ? (await q().in('status', ['pending', 'failed'])).data ?? [] : r.data ?? [];
}

/** Sends `rows` 4 at a time until `budgetMs` runs out; each row is claimed first, so overlapping runs never send one twice. */
export async function sendQueued(db: SupabaseClient, rows: any[], budgetMs: number) {
  const started = Date.now();
  let sent = 0, failed = 0;
  const orgs = new Map<string, Ctx>();
  const send = async (m: any) => {
    // claim the row: only one run can move it from this attempt count, and 'sending' keeps other runs from picking it up
    const claim = (patch: object) => db.from('tt_email_delivery_logs').update({ attempts: m.attempts + 1, ...patch })
      .eq('id', m.id).eq('attempts', m.attempts).in('status', ['pending', 'failed', 'sending']).select('id');
    let { data: claimed, error } = await claim({ status: 'sending', claimed_at: new Date().toISOString() });
    if (error) ({ data: claimed } = await claim({})); // before migration 0040
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
