import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { Badge, fmt, fmtTime, label, rpc, usePeople } from '../lib/ui';
import { ListSkeleton } from '../components/Skeleton';

const NEXT = ['not_yet_started', 'started', 'pending', 'completed'];

export default function Escalations() {
  const { membership, session } = useAuth();
  const orgId = membership!.org_id, uid = session!.user.id;
  const manager = can(membership!.role, 'escalation:manage');
  const { active, name } = usePeople(orgId);
  const [rows, setRows] = useState<any[]>([]);
  const [updates, setUpdates] = useState<Record<string, any[]>>({});
  const [filter, setFilter] = useState('open');
  const [sev, setSev] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    let q = supabase.from('tt_escalations').select('*, tt_tasks(id, title)').eq('org_id', orgId).order('raised_at', { ascending: false }).limit(200);
    if (filter === 'open') q = q.not('state', 'in', '(resolved,closed)');
    else if (filter !== 'all') q = q.eq('state', filter);
    if (sev) q = q.eq('severity', sev);
    const { data, error } = await q;
    if (error) setError(error.message);
    setRows(data ?? []); setLoading(false);
  }, [orgId, filter, sev]);
  useEffect(() => { load(); }, [load]);

  async function toggle(id: string) {
    setOpenId(openId === id ? null : id);
    const { data } = await supabase.from('tt_escalation_updates').select('*').eq('escalation_id', id).order('created_at');
    setUpdates((u) => ({ ...u, [id]: data ?? [] }));
  }
  async function act(id: string, fn: () => Promise<unknown>) {
    try { setError(''); await fn(); await load(); const { data } = await supabase.from('tt_escalation_updates').select('*').eq('escalation_id', id).order('created_at'); setUpdates((u) => ({ ...u, [id]: data ?? [] })); }
    catch (x) { setError((x as Error).message); }
  }

  const now = Date.now();
  const openRows = rows.filter((r) => !['resolved', 'closed'].includes(r.state));
  const late = (r: any) => r.target_date && new Date(r.target_date).getTime() < now && !['resolved', 'closed'].includes(r.state);
  const hours = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 36e5);

  return (
    <div className="card">
      <h2>Escalations</h2>
      <div className="stats">
        <div><b>{openRows.length}</b><span>Open (shown)</span></div>
        <div><b>{openRows.filter((r) => r.severity === 'critical').length}</b><span>Critical</span></div>
        <div><b>{openRows.filter(late).length}</b><span>Past target</span></div>
        <div><b>{openRows.filter((r) => !r.owner_id).length}</b><span>No owner</span></div>
      </div>
      <div className="row filters">
        <select aria-label="Filter by state" value={filter} onChange={(e) => setFilter(e.target.value)}>
          {['open', 'all', 'acknowledged', 'in_progress', 'waiting', 'resolved', 'closed'].map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
        <select aria-label="Filter by severity" value={sev} onChange={(e) => setSev(e.target.value)}><option value="">Any severity</option>{['low', 'medium', 'high', 'critical'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
      </div>
      {error && <p role="alert">{error}</p>}
      {loading ? <ListSkeleton /> : rows.length === 0 ? <p>No escalations. Raise one from a task’s detail page.</p> : (
        <table>
          <thead><tr><th><span className="sr-only">Details</span></th><th>Task</th><th>Severity</th><th>State</th><th>Owner</th><th>Target</th><th>Raised</th></tr></thead>
          <tbody>{rows.map((r) => (
            <Fragment key={r.id}>
              <tr>
                <td><button className="link" aria-expanded={openId === r.id} onClick={() => toggle(r.id)}>{openId === r.id ? 'Hide' : 'Details'}<span className="sr-only"> for {r.tt_tasks?.title}</span></button></td>
                <td><Link to={`/tasks/${r.task_id}`}>{r.tt_tasks?.title}</Link></td>
                <td><Badge v={r.severity} /></td><td><Badge v={r.state} /></td><td>{name(r.owner_id)}</td>
                <td className={late(r) ? 'overdue' : ''}>{fmt(r.target_date)}{late(r) && ' (past target)'}</td><td>{fmt(r.raised_at)}</td>
              </tr>
              {openId === r.id && (
                <tr><td colSpan={7}>
                  <p><b>Reason:</b> {r.reason}{r.description && <> — {r.description}</>}</p>
                  <p><small>Task was “{label(r.previous_task_status)}” before escalation. Raised by {name(r.raised_by)} {fmtTime(r.raised_at)}.
                    {r.acknowledged_at && ` Acknowledged after ${hours(r.raised_at, r.acknowledged_at)}h.`}
                    {r.resolved_at && ` Resolved after ${hours(r.raised_at, r.resolved_at)}h by ${name(r.resolved_by)}; task moved to ${label(r.resolved_task_status)}.`}</small></p>
                  {r.resolution && <p><b>Resolution:</b> {r.resolution}</p>}
                  <ul className="plain">{(updates[r.id] ?? []).map((u) => <li key={u.id}>{fmtTime(u.created_at)} — {name(u.user_id)}{u.state && <> → <Badge v={u.state} /></>}: {u.note}</li>)}</ul>
                  {(manager || r.owner_id === uid) && !['resolved', 'closed'].includes(r.state) && (<>
                    <form className="grid" onSubmit={(e: FormEvent<HTMLFormElement>) => {
                      e.preventDefault(); const f = new FormData(e.currentTarget); const form = e.currentTarget;
                      act(r.id, async () => { await rpc('tt_escalation_update', { p_esc: r.id, p_state: f.get('state'), p_note: String(f.get('note')) || null, p_owner: f.get('owner') || null }); form.reset(); });
                    }}>
                      <label>State<select name="state" defaultValue={r.state}>{['open', 'acknowledged', 'in_progress', 'waiting'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></label>
                      <label>Reassign<select name="owner"><option value="">Keep owner</option>{active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                      <label>Note<input name="note" /></label>
                      <button type="submit">Add update</button>
                    </form>
                    <form className="grid" onSubmit={(e: FormEvent<HTMLFormElement>) => {
                      e.preventDefault(); const f = new FormData(e.currentTarget);
                      act(r.id, () => rpc('tt_resolve_escalation', { p_esc: r.id, p_next_status: f.get('next'), p_resolution: f.get('resolution') }));
                    }}>
                      <label>Task status after resolution (required choice)<select name="next" required defaultValue=""><option value="" disabled>Choose…</option>
                        {NEXT.map((s) => <option key={s} value={s}>{label(s)}{s === r.previous_task_status ? ' (previous)' : ''}</option>)}</select></label>
                      <label>Resolution details<input name="resolution" required /></label>
                      <button type="submit">Resolve escalation</button>
                    </form></>)}
                  {r.state === 'resolved' && (manager || r.owner_id === uid) && <button onClick={() => act(r.id, () => rpc('tt_escalation_update', { p_esc: r.id, p_state: 'closed', p_note: 'Closed' }))}>Close</button>}
                </td></tr>)}
            </Fragment>))}
          </tbody>
        </table>
      )}
    </div>
  );
}
