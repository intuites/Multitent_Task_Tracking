import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { fmtTime, label } from '../lib/ui';

export const NOTIFICATION_TYPES = ['task_assigned', 'task_assignment_changed', 'task_status', 'task_comment', 'deadline_upcoming', 'due_today', 'task_overdue',
  'review_requested', 'escalation_raised', 'escalation_reassigned', 'escalation_due', 'escalation_resolved', 'approval_requested', 'approval_completed', 'portal_update'];

export default function Notifications() {
  const { membership, session } = useAuth();
  const orgId = membership?.org_id, uid = session!.user.id;
  const [rows, setRows] = useState<any[]>([]);
  const [prefs, setPrefs] = useState<Record<string, { in_app: boolean; email: boolean }>>({});
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    let q = supabase.from('tt_notifications').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(100);
    if (unreadOnly) q = q.is('read_at', null);
    const [n, p] = await Promise.all([q, supabase.from('tt_notification_preferences').select('*').eq('user_id', uid)]);
    setRows(n.data ?? []);
    setPrefs(Object.fromEntries((p.data ?? []).map((x: any) => [x.type, { in_app: x.in_app, email: x.email }])));
  }, [uid, unreadOnly]);
  useEffect(() => { load(); }, [load]);

  const markRead = async (id: string) => { await supabase.from('tt_notifications').update({ read_at: new Date().toISOString() }).eq('id', id); load(); };
  async function setPref(type: string, patch: Partial<{ in_app: boolean; email: boolean }>) {
    const cur = prefs[type] ?? { in_app: true, email: true };
    const { error } = await supabase.from('tt_notification_preferences').upsert({ user_id: uid, org_id: orgId, type, ...cur, ...patch });
    if (error) setError(error.message);
    load();
  }

  return (
    <div className="card">
      <div className="row">
        <h2>Notifications</h2>
        <span>
          <label className="inline"><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread only</label>
          <button onClick={async () => { await supabase.from('tt_notifications').update({ read_at: new Date().toISOString() }).eq('user_id', uid).is('read_at', null); load(); }}>Mark all read</button>
        </span>
      </div>
      {error && <p role="alert">{error}</p>}
      {rows.length === 0 ? <p>You are all caught up.</p> : (
        <ul className="plain">{rows.map((n) => (
          <li key={n.id} className={n.read_at ? '' : 'unread'}>
            {n.link ? <Link to={n.link} onClick={() => markRead(n.id)}>{n.title}</Link> : n.title}
            {n.body && <> — {n.body}</>} <small>{fmtTime(n.created_at)}</small>
            {!n.read_at && <button className="link" onClick={() => markRead(n.id)}>Mark read</button>}
          </li>))}</ul>)}
      {orgId && (
        <>
          <h3>Preferences</h3>
          <table><thead><tr><th>Event</th><th>In-app</th><th>Email</th></tr></thead>
            <tbody>{NOTIFICATION_TYPES.map((t) => {
              const p = prefs[t] ?? { in_app: true, email: true };
              return (<tr key={t}><td>{label(t)}</td>
                <td><input type="checkbox" aria-label={`${t} in-app`} checked={p.in_app} onChange={(e) => setPref(t, { in_app: e.target.checked })} /></td>
                <td><input type="checkbox" aria-label={`${t} email`} checked={p.email} onChange={(e) => setPref(t, { email: e.target.checked })} /></td></tr>);
            })}</tbody></table>
        </>
      )}
    </div>
  );
}
