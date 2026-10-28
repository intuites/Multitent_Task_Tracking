import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { TASK_STATUSES } from '../../api/_lib/taskStatus';
import { Badge, Due, dateToTs, label, rpc, usePeople } from '../lib/ui';

export type Mode = 'all' | 'mine' | 'team';
const PAGE = 25;
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const VIEWS = ['all', 'unassigned', ...TASK_STATUSES, 'overdue', 'due_today', 'upcoming', 'archived'];

export default function Tasks({ mode }: { mode: Mode }) {
  const { membership, session } = useAuth();
  const orgId = membership!.org_id, uid = session!.user.id;
  const canWrite = can(membership!.role, 'task:write');
  const { active, name } = usePeople(orgId);
  const [params] = useSearchParams();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [view, setView] = useState(params.get('view') ?? 'all');
  const [q, setQ] = useState('');
  const [priority, setPriority] = useState('');
  const [display, setDisplay] = useState<'table' | 'kanban'>('table');
  const [selected, setSelected] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(params.get('new') === '1');
  const [clients, setClients] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [formClient, setFormClient] = useState(params.get('client') ?? '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const clientFilter = params.get('client'), projectFilter = params.get('project');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    let teamIds: string[] = [];
    if (mode === 'team') {
      const [a, b] = await Promise.all([
        supabase.from('tt_team_members').select('team_id').eq('user_id', uid),
        supabase.from('tt_teams').select('id').eq('org_id', orgId).eq('manager_id', uid),
      ]);
      const teams = [...(a.data ?? []).map((x) => x.team_id), ...(b.data ?? []).map((x) => x.id)];
      if (teams.length) {
        const { data } = await supabase.from('tt_team_members').select('user_id').in('team_id', teams);
        teamIds = [...new Set((data ?? []).map((x) => x.user_id))];
      }
      if (!teamIds.length) { setRows([]); setTotal(0); setLoading(false); return; }
    }
    const inner = mode !== 'all';
    let qy = supabase.from('tt_tasks')
      .select(`*, clients(name), projects(name), tt_task_assignees${inner ? '!inner' : ''}(user_id)`, { count: 'exact' })
      .eq('org_id', orgId);
    if (mode === 'mine') qy = qy.eq('tt_task_assignees.user_id', uid);
    if (mode === 'team') qy = qy.in('tt_task_assignees.user_id', teamIds);
    if (clientFilter) qy = qy.eq('client_id', clientFilter);
    if (projectFilter) qy = qy.eq('project_id', projectFilter);
    if (q.trim()) qy = qy.ilike('title', `%${q.trim().replace(/[%,()*]/g, ' ')}%`);
    if (priority) qy = qy.eq('priority', priority);

    const now = new Date(), start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    const week = new Date(start); week.setDate(week.getDate() + 8);
    const open = '(completed,cancelled)';
    if (view === 'archived') qy = qy.not('archived_at', 'is', null);
    else qy = qy.is('archived_at', null);
    if (view === 'unassigned') qy = qy.is('tt_task_assignees', null);
    else if (view === 'overdue') qy = qy.lt('due_date', now.toISOString()).not('status', 'in', open);
    else if (view === 'due_today') qy = qy.gte('due_date', start.toISOString()).lt('due_date', end.toISOString()).not('status', 'in', open);
    else if (view === 'upcoming') qy = qy.gte('due_date', end.toISOString()).lt('due_date', week.toISOString()).not('status', 'in', open);
    else if ((TASK_STATUSES as readonly string[]).includes(view)) qy = qy.eq('status', view);

    qy = qy.order(view === 'overdue' || view === 'upcoming' ? 'due_date' : 'created_at', { ascending: view === 'overdue' || view === 'upcoming' });
    qy = display === 'kanban' ? qy.range(0, 199) : qy.range(page * PAGE, page * PAGE + PAGE - 1);
    const { data, count, error } = await qy;
    if (error) setError(error.message);
    setRows(data ?? []); setTotal(count ?? 0); setSelected([]); setLoading(false);
  }, [orgId, uid, mode, view, q, priority, page, display, clientFilter, projectFilter]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!canWrite) return;
    Promise.all([
      supabase.from('clients').select('id, name').eq('org_id', orgId).neq('status', 'archived').order('name'),
      supabase.from('projects').select('id, name, client_id').eq('org_id', orgId).neq('status', 'archived').order('name'),
    ]).then(([c, p]) => { setClients(c.data ?? []); setProjects(p.data ?? []); });
  }, [orgId, canWrite]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError('');
    try {
      const { data, error } = await supabase.from('tt_tasks').insert({
        org_id: orgId, created_by: uid, title: String(f.get('title')).trim(), description: String(f.get('description')).trim() || null,
        priority: f.get('priority'), client_id: f.get('client_id') || null, project_id: f.get('project_id') || null,
        start_date: dateToTs(f.get('start_date')), due_date: dateToTs(f.get('due_date')),
        estimated_hours: f.get('estimated_hours') ? Number(f.get('estimated_hours')) : null,
        tags: String(f.get('tags')).split(',').map((s) => s.trim()).filter(Boolean),
        client_visible: f.get('client_visible') === 'on', requires_approval: f.get('requires_approval') === 'on',
      }).select('id').single();
      if (error) throw error;
      for (const a of f.getAll('assignees')) await rpc('tt_assign', { p_task: data.id, p_user: a, p_add: true });
      const freq = String(f.get('freq'));
      if (freq) await rpc('tt_set_recurrence', { p_task: data.id, p_freq: freq, p_n: Number(f.get('every') || 1), p_until: f.get('until') || null });
      await supabase.from('tt_activity_logs').insert({ org_id: orgId, actor_id: uid, entity_type: 'task', entity_id: data.id, action: 'created' });
      setShowForm(false); load();
    } catch (x) { setError((x as Error).message); }
  }

  async function bulk(patch: object) {
    const { error } = await supabase.from('tt_tasks').update(patch).in('id', selected);
    if (error) return setError(error.message);
    load();
  }
  async function quickStatus(id: string, to: string) {
    try { await rpc('tt_set_task_status', { p_task: id, p_to: to }); load(); } catch (x) { setError((x as Error).message); }
  }

  const title = mode === 'mine' ? 'My Tasks' : mode === 'team' ? 'Team Tasks' : 'Tasks';
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const names = (t: any) => (t.tt_task_assignees ?? []).map((a: any) => name(a.user_id)).join(', ') || 'Unassigned';

  return (
    <div className="card">
      <div className="row">
        <h2>{title}</h2>
        <span>
          <button className="link" onClick={() => setDisplay(display === 'table' ? 'kanban' : 'table')}>{display === 'table' ? 'Kanban' : 'Table'}</button>
          {canWrite && <button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Cancel' : 'New task'}</button>}
        </span>
      </div>
      {showForm && (
        <form className="grid" onSubmit={create}>
          <label>Title<input name="title" required maxLength={200} /></label>
          <label>Priority<select name="priority" defaultValue="medium">{PRIORITIES.map((p) => <option key={p} value={p}>{label(p)}</option>)}</select></label>
          <label>Client<select name="client_id" value={formClient} onChange={(e) => setFormClient(e.target.value)}><option value="">— none —</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Project<select name="project_id" defaultValue={params.get('project') ?? ''}><option value="">— none —</option>
            {projects.filter((p) => !formClient || p.client_id === formClient).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Start<input type="date" name="start_date" /></label>
          <label>Due<input type="date" name="due_date" /></label>
          <label>Estimated hours<input type="number" step="0.25" min="0" name="estimated_hours" /></label>
          <label>Tags (comma separated)<input name="tags" /></label>
          <label>Description<textarea name="description" rows={2} /></label>
          <fieldset><legend>Assignees</legend>
            {active.map((p) => <label key={p.id} className="inline"><input type="checkbox" name="assignees" value={p.id} /> {p.name}</label>)}
          </fieldset>
          <fieldset><legend>Repeat</legend>
            <select aria-label="Repeat" name="freq" defaultValue=""><option value="">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="custom">Every N days</option></select>
            <label>Every<input type="number" name="every" min={1} max={365} defaultValue={1} /></label>
            <label>Until<input type="date" name="until" /></label>
          </fieldset>
          <label className="inline"><input type="checkbox" name="client_visible" /> Visible to client</label>
          <label className="inline"><input type="checkbox" name="requires_approval" /> Requires approval</label>
          <button type="submit">Create task (starts as Not Yet Started)</button>
        </form>
      )}
      <div className="row filters">
        <input aria-label="Search tasks by title" placeholder="Search title" value={q} onChange={(e) => { setPage(0); setQ(e.target.value); }} />
        <select aria-label="Task view" value={view} onChange={(e) => { setPage(0); setView(e.target.value); }}>{VIEWS.map((v) => <option key={v} value={v}>{label(v)}</option>)}</select>
        <select aria-label="Filter by priority" value={priority} onChange={(e) => { setPage(0); setPriority(e.target.value); }}><option value="">Any priority</option>{PRIORITIES.map((p) => <option key={p} value={p}>{label(p)}</option>)}</select>
        {(clientFilter || projectFilter) && <Link to="/tasks">Clear client/project filter</Link>}
      </div>
      {canWrite && selected.length > 0 && (
        <div className="row filters">
          <span>{selected.length} selected</span>
          <button onClick={() => bulk({ archived_at: new Date().toISOString() })}>Archive</button>
          <button onClick={() => bulk({ archived_at: null })}>Restore</button>
          {PRIORITIES.map((p) => <button key={p} className="link" onClick={() => bulk({ priority: p })}>Set {label(p)}</button>)}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {loading ? <p>Loading…</p> : rows.length === 0 ? <p>No tasks match.{canWrite && ' Use “New task” to create one.'}</p> : display === 'table' ? (
        <table>
          <thead><tr>{canWrite && <th />}<th>Title</th><th>Status</th><th>Priority</th><th>Assignees</th><th>Client / Project</th><th>Due</th></tr></thead>
          <tbody>{rows.map((t) => (
            <tr key={t.id}>
              {canWrite && <td><input type="checkbox" aria-label="Select" checked={selected.includes(t.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, t.id] : selected.filter((x) => x !== t.id))} /></td>}
              <td><Link to={`/tasks/${t.id}`}>{t.title}</Link></td><td><Badge v={t.status} /></td><td>{label(t.priority)}</td>
              <td>{names(t)}</td><td>{t.clients?.name ?? '—'} / {t.projects?.name ?? '—'}</td>
              <td><Due t={t} /></td>
            </tr>
          ))}</tbody>
        </table>
      ) : (
        <div className="kanban">{TASK_STATUSES.map((s) => (
          <div key={s} className="col"><h4>{label(s)}</h4>
            {rows.filter((t) => t.status === s).map((t) => (
              <div key={t.id} className="kcard"><Link to={`/tasks/${t.id}`}>{t.title}</Link><br /><small>{names(t)}</small>
                {s !== 'escalation' && (
                  <select aria-label={`Move ${t.title} to`} value={s} onChange={(e) => quickStatus(t.id, e.target.value)}>
                    {TASK_STATUSES.filter((x) => x === s || x !== 'escalation').map((x) => <option key={x} value={x}>{label(x)}</option>)}
                  </select>)}
              </div>))}
          </div>))}
        </div>
      )}
      {display === 'table' && (
        <div className="row">
          <button disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</button>
          <span>Page {page + 1} of {pages} ({total})</span>
          <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
