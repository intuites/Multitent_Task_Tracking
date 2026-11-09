// Turns queued email rows into styled emails, and queues the midday / end-of-day digests.
import type { SupabaseClient } from '@supabase/supabase-js';
import { digest, generic, taskCompleted, taskCreated, taskReminder, type Ctx, type DigestRow, type Mail, type TaskMail } from './emailTemplates.js';

const NY = 'America/New_York';
/** An organization's digest settings (Organization settings → Digest emails), in its own time zone. */
export interface DigestCfg { midOn: boolean; mid: string; eodOn: boolean; eod: string; days: 'daily' | 'weekdays'; leads: boolean; extra: string[] }
/** Defaults (and the values used before migration 0032): the 9:00-18:00 New York workday's middle, and 10 minutes before close. */
export const digestCfg = (o: any = {}): DigestCfg => ({
  midOn: o.digest_midday_on ?? true, mid: String(o.digest_midday ?? '13:30').slice(0, 5),
  eodOn: o.digest_eod_on ?? true, eod: String(o.digest_eod ?? '17:50').slice(0, 5),
  days: o.digest_days === 'weekdays' ? 'weekdays' : 'daily', leads: o.digest_leads ?? true, extra: o.digest_extra_emails ?? [],
});
const DONE = ['completed', 'completed_cycle'];
const appUrl = () => (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');

type Db = SupabaseClient;
async function names(db: Db, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  const { data } = await db.from('tt_profiles').select('user_id, full_name, email').in('user_id', list);
  return new Map((data ?? []).map((p: any) => [p.user_id as string, (p.full_name || p.email) as string]));
}

async function ctxFor(db: Db, orgId: string, cache: Map<string, Ctx>): Promise<Ctx> {
  if (!cache.has(orgId)) {
    const { data } = await db.from('tt_organizations').select('name, time_zone').eq('id', orgId).maybeSingle();
    cache.set(orgId, { org: data?.name ?? 'your organization', tz: data?.time_zone || NY, appUrl: appUrl() });
  }
  return cache.get(orgId)!;
}

export async function loadTask(db: Db, id: string): Promise<TaskMail | null> {
  const { data: t } = await db.from('tt_tasks').select('*').eq('id', id).maybeSingle();
  if (!t) return null;
  const [as, hi, dep] = await Promise.all([
    db.from('tt_task_assignees').select('user_id').eq('task_id', id),
    db.from('tt_task_status_history').select('changed_at, to_status, reason, changed_by').eq('task_id', id).order('changed_at', { ascending: false }).limit(50),
    t.department_id ? db.from('tt_departments').select('name').eq('id', t.department_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const n = await names(db, [...(as.data ?? []).map((a: any) => a.user_id), ...(hi.data ?? []).map((h: any) => h.changed_by),
    t.created_by, t.completed_by, t.lead_id, t.manager_id]);
  const who = (u: string | null) => (u ? n.get(u) ?? null : null);
  return {
    id: t.id, title: t.title, description: t.description, status: t.status, priority: t.priority ?? 'medium',
    due_date: t.due_date, created_at: t.created_at, completed_at: t.completed_at,
    department: (dep.data as any)?.name ?? null, assignees: (as.data ?? []).map((a: any) => who(a.user_id)).filter(Boolean) as string[],
    createdBy: who(t.created_by), completedBy: who(t.completed_by), lead: who(t.lead_id), manager: who(t.manager_id),
    history: (hi.data ?? []).map((h: any) => ({ at: h.changed_at, status: h.to_status, comment: h.reason, user: who(h.changed_by) })),
  };
}

const TASK_KINDS = ['task_assigned', 'task_reminder', 'task_status', 'task_completed'];
/** A queued row as a styled email. Rows from before migration 0031 (no kind/link) get the plain styled layout. */
export async function render(db: Db, m: any, cache: Map<string, Ctx>): Promise<Mail> {
  const ctx = await ctxFor(db, m.org_id, cache);
  const id = /^\/tasks\/([0-9a-f-]{36})$/i.exec(m.link ?? '')?.[1];
  const t = id && TASK_KINDS.includes(m.kind) ? await loadTask(db, id) : null;
  if (t) {
    if (m.kind === 'task_completed' || (m.kind === 'task_status' && t.status === 'completed' && / is now completed$/.test(m.subject))) return taskCompleted(t, ctx);
    if (m.kind === 'task_reminder') return taskReminder(t, ctx);
    if (m.kind === 'task_assigned') {
      const k = String(m.dedup_key ?? '');
      return taskCreated(t, ctx, k.startsWith('cc:') ? "You're copied on a new task." : k.startsWith('lead:') ? 'A member of your team was assigned a new task.' : "You've been assigned a new task.");
    }
  }
  return generic(m.subject, m.body ?? '', m.link ?? null, ctx);
}

/** Local calendar day and HH:MM in a time zone. */
export function localClock(now: Date, tz: string) {
  const date = now.toLocaleDateString('en-CA', { timeZone: tz });
  const hm = now.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return { date, hm };
}
/** Which digest is due at local time `hm` on `date`, if any (the caller sends each at most once per day). */
export function digestDue(hm: string, c: DigestCfg = digestCfg(), date?: string): 'midday' | 'eod' | null {
  const dow = date ? new Date(`${date}T12:00:00Z`).getUTCDay() : 1;
  if (c.days === 'weekdays' && (dow === 0 || dow === 6)) return null;
  if (c.eodOn && hm >= c.eod) return 'eod';
  return c.midOn && hm >= c.mid ? 'midday' : null;
}

/** Queues today's digest for every organization whose time has come (admins: everything; leads and managers: their tasks). */
export async function queueDigests(db: Db, now = new Date()) {
  const { data: orgs } = await db.from('tt_organizations').select('*'); // '*': digest settings arrive with migration 0032
  let queued = 0;
  for (const o of orgs ?? []) {
    const cfg = digestCfg(o), tz = o.time_zone || NY, { date, hm } = localClock(now, tz), kind = digestDue(hm, cfg, date);
    if (!kind) continue;
    const key = `digest:${kind}:${o.id}:${date}`;
    const { data: seen } = await db.from('tt_email_delivery_logs').select('id').eq('org_id', o.id).eq('dedup_key', key).limit(1);
    if (seen?.length) continue;

    const [open, done, members, depts] = await Promise.all([
      db.from('tt_tasks').select('id, title, status, priority, due_date, created_at, department_id, lead_id, manager_id, tt_task_assignees(user_id)')
        .eq('org_id', o.id).is('archived_at', null).not('status', 'in', `(${DONE.join(',')})`).limit(5000),
      db.from('tt_tasks').select('completed_at, lead_id, manager_id').eq('org_id', o.id).in('status', DONE).gte('completed_at', new Date(now.getTime() - 36 * 3600e3).toISOString()),
      db.from('tt_org_members').select('user_id, role, active').eq('org_id', o.id),
      db.from('tt_departments').select('id, name').eq('org_id', o.id),
    ]);
    const tasks = open.data ?? [];
    const doneToday = (done.data ?? []).filter((t: any) => t.completed_at && localClock(new Date(t.completed_at), tz).date === date);
    if (!tasks.length && !doneToday.length) continue; // nothing happening in this organization

    const deptName = new Map((depts.data ?? []).map((d: any) => [d.id, d.name]));
    const n = await names(db, tasks.flatMap((t: any) => t.tt_task_assignees.map((a: any) => a.user_id)));
    const rows: (DigestRow & { lead_id: string | null; manager_id: string | null })[] = tasks.map((t: any) => ({
      id: t.id, title: t.title, status: t.status, priority: t.priority ?? 'medium', due_date: t.due_date, created_at: t.created_at,
      department: deptName.get(t.department_id) ?? null, assignees: t.tt_task_assignees.map((a: any) => n.get(a.user_id)).filter(Boolean),
      lead_id: t.lead_id, manager_id: t.manager_id,
    }));
    const admins = new Set((members.data ?? []).filter((m: any) => m.active !== false && ['owner', 'admin'].includes(m.role)).map((m: any) => m.user_id as string));
    // only people still active here: someone removed stays on old tasks as lead or manager but gets nothing more
    const active = new Set((members.data ?? []).filter((m: any) => m.active !== false).map((m: any) => m.user_id as string));
    const leads = new Set(cfg.leads ? rows.flatMap((r) => [r.lead_id, r.manager_id]).filter((u): u is string => !!u && active.has(u) && !admins.has(u)) : []);
    const emails = new Map((await db.from('tt_profiles').select('user_id, email').in('user_id', [...admins, ...leads])).data?.map((p: any) => [p.user_id, p.email]) ?? []);
    const ctx: Ctx = { org: o.name, tz, appUrl: appUrl() };

    const out: any[] = [];
    // uid null = an extra address from settings (not a Taskify user): it gets the whole-organization digest
    const add = (uid: string | null, list: typeof rows, doneN: number, scope: string, to = uid ? emails.get(uid) : undefined) => {
      if (!to) return;
      const counts = {
        open: list.length, overdue: list.filter((r) => r.due_date && new Date(r.due_date) < now).length,
        dueToday: list.filter((r) => r.due_date && localClock(new Date(r.due_date), tz).date === date).length, doneToday: doneN,
      };
      const mail = digest(kind, list, counts, ctx, scope, now);
      out.push({ org_id: o.id, user_id: uid, to_email: to, subject: mail.subject, body: mail.text, html: mail.html, dedup_key: key, kind: 'digest' });
    };
    for (const u of admins) add(u, rows, doneToday.length, `All departments in ${o.name}`);
    const sentTo = new Set(out.map((r) => String(r.to_email).toLowerCase()));
    for (const e of cfg.extra) if (!sentTo.has(e.toLowerCase())) add(null, rows, doneToday.length, `All departments in ${o.name}`, e);
    for (const u of leads) {
      const mine = rows.filter((r) => r.lead_id === u || r.manager_id === u);
      if (mine.length) add(u, mine, doneToday.filter((t: any) => t.lead_id === u || t.manager_id === u).length, 'Tasks you lead or manage');
    }
    if (!out.length) continue;
    const { error } = await db.from('tt_email_delivery_logs').upsert(out, { onConflict: 'user_id,dedup_key', ignoreDuplicates: true });
    if (error) throw new Error(`digest ${o.id}: ${error.message}`);
    queued += out.length;
  }
  return queued;
}
