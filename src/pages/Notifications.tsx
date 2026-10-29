import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlarmClock, BadgeCheck, BellOff, Building2, CalendarClock, Check, CheckCheck, Eye, MessageSquare, RefreshCw, Siren, UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { ListSkeleton } from '../components/Skeleton';

type Tone = 'brand' | 'warn' | 'bad' | 'ok';
interface TypeInfo { label: string; hint: string; icon: LucideIcon; tone: Tone }

// Every event tt_notify can send, grouped the way people think about them.
const TYPES: Record<string, TypeInfo> = {
  task_assigned: { label: 'Assigned to me', hint: 'Someone gives you a task', icon: UserPlus, tone: 'brand' },
  task_assignment_changed: { label: 'Removed from a task', hint: 'You are unassigned', icon: UserPlus, tone: 'brand' },
  task_status: { label: 'Status changes', hint: 'A task you follow moves', icon: RefreshCw, tone: 'brand' },
  task_comment: { label: 'New comments', hint: 'Replies on your tasks', icon: MessageSquare, tone: 'brand' },
  review_requested: { label: 'Review requests', hint: 'A task is ready for review', icon: Eye, tone: 'brand' },
  deadline_upcoming: { label: 'Due soon', hint: 'Within the next 24 hours', icon: CalendarClock, tone: 'warn' },
  due_today: { label: 'Due today', hint: 'On the morning it is due', icon: CalendarClock, tone: 'warn' },
  task_overdue: { label: 'Overdue', hint: 'Once a day while overdue', icon: AlarmClock, tone: 'bad' },
  escalation_raised: { label: 'Escalation raised', hint: 'A task is escalated to you', icon: Siren, tone: 'bad' },
  escalation_reassigned: { label: 'Escalation reassigned', hint: 'You become the owner', icon: Siren, tone: 'bad' },
  escalation_due: { label: 'Escalation target near', hint: 'Target date is close', icon: Siren, tone: 'bad' },
  escalation_resolved: { label: 'Escalation resolved', hint: 'Someone resolves it', icon: Siren, tone: 'ok' },
  approval_requested: { label: 'Approval requested', hint: 'Your decision is needed', icon: BadgeCheck, tone: 'ok' },
  approval_completed: { label: 'Approval decided', hint: 'Approved or rejected', icon: BadgeCheck, tone: 'ok' },
  portal_update: { label: 'Client updates', hint: 'Client requests and replies', icon: Building2, tone: 'brand' },
};
const GROUPS: [string, string[]][] = [
  ['Tasks', ['task_assigned', 'task_assignment_changed', 'task_status', 'task_comment', 'review_requested']],
  ['Deadlines', ['deadline_upcoming', 'due_today', 'task_overdue']],
  ['Escalations', ['escalation_raised', 'escalation_reassigned', 'escalation_due', 'escalation_resolved']],
  ['Clients', ['portal_update']],
];
const fallback: TypeInfo = { label: 'Update', hint: '', icon: RefreshCw, tone: 'brand' };
const PAGE = 40;

const dayLabel = (d: Date) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });
};
const ago = (d: string) => {
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  return m < 1 ? 'Just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};
// tell the top bar badge to refresh right away instead of on its next poll
const announce = () => window.dispatchEvent(new Event('tt-notifications'));

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={on ? 'switch on' : 'switch'} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

export default function Notifications() {
  const { membership, session } = useAuth();
  const orgId = membership?.org_id, uid = session!.user.id;
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [prefs, setPrefs] = useState<Record<string, { in_app: boolean; email: boolean }>>({});
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    let q = supabase.from('tt_notifications').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(limit + 1);
    if (filter === 'unread') q = q.is('read_at', null);
    const [n, c, p] = await Promise.all([
      q,
      supabase.from('tt_notifications').select('id', { count: 'exact', head: true }).eq('user_id', uid).is('read_at', null),
      supabase.from('tt_notification_preferences').select('*').eq('user_id', uid),
    ]);
    if (n.error) setError(n.error.message);
    setRows(n.data ?? []); setUnread(c.count ?? 0);
    setPrefs(Object.fromEntries((p.data ?? []).map((x: any) => [x.type, { in_app: x.in_app, email: x.email }])));
  }, [uid, filter, limit]);
  useEffect(() => {
    load();
    window.addEventListener('tt-notifications', load);
    return () => window.removeEventListener('tt-notifications', load);
  }, [load]);

  async function markRead(ids: string[] | 'all') {
    let q = supabase.from('tt_notifications').update({ read_at: new Date().toISOString() }).eq('user_id', uid).is('read_at', null);
    if (ids !== 'all') q = q.in('id', ids);
    await q;
    announce(); // the page listens for this too, so one event refreshes the list and the badge
  }
  async function open(n: any) {
    if (!n.read_at) await markRead([n.id]);
    if (n.link) navigate(n.link);
  }
  async function setPref(type: string, patch: Partial<{ in_app: boolean; email: boolean }>) {
    const cur = prefs[type] ?? { in_app: true, email: true };
    setPrefs({ ...prefs, [type]: { ...cur, ...patch } }); // optimistic; reverted by reload on error
    const { error } = await supabase.from('tt_notification_preferences').upsert({ user_id: uid, org_id: orgId, type, ...cur, ...patch });
    if (error) { setError(error.message); load(); }
  }

  const shown = (rows ?? []).slice(0, limit);
  const groups: [string, any[]][] = [];
  for (const n of shown) {
    const d = dayLabel(new Date(n.created_at));
    const g = groups.find((x) => x[0] === d);
    if (g) g[1].push(n); else groups.push([d, [n]]);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2 className="page-title">Notifications</h2>
          <p className="page-sub">{unread ? `${unread} unread ${unread === 1 ? 'notification' : 'notifications'}` : 'You are all caught up.'}</p>
        </div>
        <div className="page-actions">
          <div className="seg" role="group" aria-label="Show">
            <button type="button" aria-pressed={filter === 'all'} onClick={() => { setFilter('all'); setLimit(PAGE); }}>All</button>
            <button type="button" aria-pressed={filter === 'unread'} onClick={() => { setFilter('unread'); setLimit(PAGE); }}>Unread{unread > 0 && <span className="seg-count">{unread}</span>}</button>
          </div>
          <button type="button" className="pill-btn ghost" disabled={!unread} onClick={() => markRead('all')}><CheckCheck size={16} aria-hidden="true" />Mark all read</button>
        </div>
      </div>
      {error && <p role="alert" className="card">{error}</p>}

      <div className={orgId ? 'notif-layout' : ''}>
        <section className="card inbox" aria-label="Notifications">
          {rows === null ? <ListSkeleton rows={5} /> : shown.length === 0 ? (
            <div className="inbox-empty">
              <span className="empty-ico"><BellOff size={22} aria-hidden="true" /></span>
              <b>{filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}</b>
              <p className="muted">{filter === 'unread' ? 'Everything here has been read.' : 'Assignments, comments, deadlines and escalations will show up here.'}</p>
            </div>
          ) : groups.map(([day, items]) => (
            <div key={day} className="inbox-day">
              <h3 className="inbox-day-title">{day}</h3>
              <ul className="inbox-list">{items.map((n) => {
                const t = TYPES[n.type] ?? fallback;
                return (
                  <li key={n.id} className={n.read_at ? 'inbox-item' : 'inbox-item new'}>
                    <span className={`inbox-ico t-${t.tone}`} aria-hidden="true"><t.icon size={17} /></span>
                    <button type="button" className="inbox-main" onClick={() => open(n)}>
                      <span className="inbox-title">{n.title}</span>
                      {n.body && <span className="inbox-body">{n.body}</span>}
                      <span className="inbox-meta">{t.label} · {ago(n.created_at)}</span>
                    </button>
                    {!n.read_at && (<>
                      <span className="inbox-dot" aria-label="Unread" />
                      <button type="button" className="icon-btn sm" onClick={() => markRead([n.id])} title="Mark as read"><Check size={15} aria-hidden="true" /><span className="sr-only">Mark as read</span></button>
                    </>)}
                  </li>
                );
              })}</ul>
            </div>
          ))}
          {(rows?.length ?? 0) > limit && <button type="button" className="pill-btn ghost wide" onClick={() => setLimit(limit + PAGE)}>Show older</button>}
        </section>

        {orgId && (
          <aside className="card prefs" aria-labelledby="prefs-h">
            <h3 id="prefs-h">What to notify me about</h3>
            <p className="muted prefs-sub">Turn off anything you don't need. Email needs an email provider to be set up.</p>
            <div className="prefs-cols" aria-hidden="true"><span>In app</span><span>Email</span></div>
            {GROUPS.map(([g, types]) => (
              <div key={g} className="prefs-group">
                <p className="prefs-group-title">{g}</p>
                {types.map((type) => {
                  const p = prefs[type] ?? { in_app: true, email: true };
                  const t = TYPES[type];
                  return (
                    <div key={type} className="pref-row">
                      <span className="pref-text"><b>{t.label}</b><small>{t.hint}</small></span>
                      <Switch on={p.in_app} label={`${t.label}: in-app`} onChange={(v) => setPref(type, { in_app: v })} />
                      <Switch on={p.email} label={`${t.label}: email`} onChange={(v) => setPref(type, { email: v })} />
                    </div>
                  );
                })}
              </div>
            ))}
          </aside>
        )}
      </div>
    </>
  );
}
