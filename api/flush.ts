import { admin, authUser, handler } from './_lib/http.js';
import { sendQueued } from './_lib/sendQueue.js';

const FRESH_MS = 15 * 60e3, MAX = 20;

// POST -> sends the new emails waiting in the caller's organizations right away (task created, assigned, status changed),
// instead of waiting for the next scheduled run. Only rows already queued by the database are sent; retries stay with the job.
export default handler('POST', async (req) => {
  const user = await authUser(req);
  const db = admin();
  const [{ data: mem }, { data: pa }] = await Promise.all([
    db.from('tt_org_members').select('org_id').eq('user_id', user.id).eq('active', true),
    db.from('tt_platform_admins').select('user_id').eq('user_id', user.id).maybeSingle(),
  ]);
  let q = db.from('tt_email_delivery_logs').select('*').eq('status', 'pending').eq('attempts', 0)
    .gte('created_at', new Date(Date.now() - FRESH_MS).toISOString()).order('created_at').limit(MAX);
  if (!pa) {
    const orgs = (mem ?? []).map((m) => m.org_id as string);
    if (!orgs.length) return { sent: 0, failed: 0, left_for_next_run: 0 };
    q = q.in('org_id', orgs);
  }
  const { data } = await q;
  return sendQueued(db, data ?? [], 20_000);
});
