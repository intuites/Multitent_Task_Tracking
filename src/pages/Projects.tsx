import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { logActivity } from '../lib/activity';
import { Badge, fmtDay, label } from '../lib/ui';

export const PROJECT_STATUSES = ['planning', 'not_started', 'in_progress', 'on_hold', 'in_review', 'completed', 'cancelled', 'archived'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

export default function Projects() {
  const { membership, session } = useAuth();
  const orgId = membership!.org_id;
  const canWrite = can(membership!.role, 'project:write');
  const [rows, setRows] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [view, setView] = useState<'list' | 'kanban'>('list');
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [p, c] = await Promise.all([
      supabase.from('tt_projects').select('*, clients:tt_clients(name)').eq('org_id', orgId).neq('status', 'archived').order('created_at', { ascending: false }).limit(200),
      supabase.from('tt_clients').select('id, name').eq('org_id', orgId).neq('status', 'archived').order('name'),
    ]);
    setError(p.error?.message ?? '');
    setRows(p.data ?? []); setClients(c.data ?? []); setLoading(false);
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { data, error } = await supabase.from('tt_projects').insert({
      org_id: orgId, name: String(f.get('name')).trim(), client_id: f.get('client_id') || null,
      priority: f.get('priority'), status: 'planning', manager_id: session!.user.id,
      start_date: f.get('start_date') || null, due_date: f.get('due_date') || null,
    }).select('id').single();
    if (error) return setError(error.message);
    await logActivity(orgId, session!.user.id, 'project', data.id, 'created');
    setShowForm(false); load();
  }

  const shown = rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));
  const overdue = (r: any) => r.due_date && r.due_date < new Date().toISOString().slice(0, 10) && !['completed', 'cancelled'].includes(r.status);

  return (
    <div className="card">
      <div className="row">
        <h2>Projects</h2>
        <span>
          <button className="link" onClick={() => setView(view === 'list' ? 'kanban' : 'list')}>{view === 'list' ? 'Kanban view' : 'List view'}</button>
          {canWrite && <button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Cancel' : 'New project'}</button>}
        </span>
      </div>
      {showForm && (
        <form className="grid" onSubmit={create}>
          <label>Name<input name="name" required maxLength={200} /></label>
          <label>Client<select name="client_id"><option value="">— none —</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Priority<select name="priority" defaultValue="medium">{PRIORITIES.map((p) => <option key={p} value={p}>{label(p)}</option>)}</select></label>
          <label>Start<input name="start_date" type="date" /></label>
          <label>Due<input name="due_date" type="date" /></label>
          <button type="submit">Save</button>
        </form>
      )}
      <div className="row filters"><input aria-label="Search projects" placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {error && <p role="alert">{error}</p>}
      {loading ? <p>Loading…</p> : shown.length === 0 ? <p>No projects found.{canWrite && ' Use “New project” to add one.'}</p> : view === 'list' ? (
        <table>
          <thead><tr><th>Name</th><th>Client</th><th>Status</th><th>Priority</th><th>Due</th></tr></thead>
          <tbody>{shown.map((p) => (
            <tr key={p.id}><td><Link to={`/projects/${p.id}`}>{p.name}</Link></td><td>{p.clients?.name ?? '—'}</td><td><Badge v={p.status} /></td><td>{label(p.priority)}</td>
              <td className={overdue(p) ? 'overdue' : ''}>{fmtDay(p.due_date)}{overdue(p) && ' (overdue)'}</td></tr>
          ))}</tbody>
        </table>
      ) : (
        <div className="kanban">
          {PROJECT_STATUSES.filter((s) => s !== 'archived').map((s) => (
            <div key={s} className="col"><h4>{label(s)}</h4>
              {shown.filter((p) => p.status === s).map((p) => <Link key={p.id} to={`/projects/${p.id}`} className="kcard">{p.name}</Link>)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
