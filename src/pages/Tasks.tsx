import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, ListTree, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { TASK_STATUSES } from '../../api/_lib/taskStatus';
import { Badge, Due, isOpen as isOpenStatus, label, usePeople } from '../lib/ui';
import { ListSkeleton } from '../components/Skeleton';
import { ask } from '../components/Dialog';
import NewTaskForm from '../components/NewTaskForm';
import { useLive } from '../lib/live';

export type Mode = 'all' | 'mine';
const PAGE = 25;
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const VIEWS = ['all', 'unassigned', ...TASK_STATUSES.filter((s) => s !== 'escalation'), 'overdue', 'due_today', 'upcoming', 'archived'];

export default function Tasks({ mode }: { mode: Mode }) {
  const { membership, session } = useAuth();
  const orgId = membership!.org_id, uid = session!.user.id;
  const canWrite = can(membership!.role, 'task:write');
  const { active, name } = usePeople(orgId);
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [view, setView] = useState(params.get('view') ?? 'all');
  const [q, setQ] = useState('');
  const [priority, setPriority] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [subs, setSubs] = useState<Record<string, any[]>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [showForm, setShowForm] = useState(canWrite && params.get('new') === '1');
  // the form opens as a side panel over the list (native modal <dialog>: focus stays inside, Esc closes)
  const sheet = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (showForm && sheet.current && !sheet.current.open) sheet.current.showModal(); }, [showForm]);
  // links like the top bar's "New task" (?new=1) or a dashboard card (?view=…) also land here while the page is already open
  useEffect(() => {
    const v = params.get('view');
    if (v) setView(v);
    if (params.get('new') === '1') {
      if (canWrite) setShowForm(true); // employees can't create tasks: the link just opens the list
      const next = new URLSearchParams(params); next.delete('new');
      setParams(next, { replace: true }); // drop it so the next click opens the form again
    }
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // the list's query (filters + order, no paging), shared by the page and by exports
  const query = useCallback((count = false) => {
    // My Tasks filters on a second copy ("mine"), so the Assignees column still lists everyone on the task
    let qy = supabase.from('tt_tasks')
      .select(`*, departments:tt_departments(name), tt_task_assignees(user_id)${mode === 'mine' ? ', mine:tt_task_assignees!inner(user_id)' : ''}`, count ? { count: 'exact' } : undefined)
      .eq('org_id', orgId);
    if (mode === 'mine') qy = qy.eq('mine.user_id', uid);
    if (q.trim()) qy = qy.ilike('title', `%${q.trim().replace(/[%,()*]/g, ' ')}%`);
    if (priority) qy = qy.eq('priority', priority);
    // on the main list subtasks sit under their parent; My Tasks still list them so people see their own work
    if (mode === 'all' && !q.trim()) qy = qy.is('parent_task_id', null);

    const now = new Date(), start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    const week = new Date(start); week.setDate(week.getDate() + 8);
    const open = '(completed,completed_cycle)';
    if (view === 'archived') qy = qy.not('archived_at', 'is', null);
    else qy = qy.is('archived_at', null);
    if (view === 'unassigned') qy = qy.is('tt_task_assignees', null);
    else if (view === 'overdue') qy = qy.lt('due_date', now.toISOString()).not('status', 'in', open);
    else if (view === 'due_today') qy = qy.gte('due_date', start.toISOString()).lt('due_date', end.toISOString()).not('status', 'in', open);
    else if (view === 'upcoming') qy = qy.gte('due_date', end.toISOString()).lt('due_date', week.toISOString()).not('status', 'in', open);
    else if ((TASK_STATUSES as readonly string[]).includes(view)) qy = qy.eq('status', view);

    return qy.order(view === 'overdue' || view === 'upcoming' ? 'due_date' : 'created_at', { ascending: view === 'overdue' || view === 'upcoming' }).order('id');
  }, [orgId, uid, mode, view, q, priority]);

  // quiet = a live refresh: no skeleton flash, and ticked rows stay ticked
  const latest = useRef(0);
  const load = useCallback(async (quiet = false) => {
    const mine = ++latest.current; // a slower, older search must not overwrite a newer one
    if (!quiet) setLoading(true);
    setError('');
    const { data, count, error } = await query(true).range(page * PAGE, page * PAGE + PAGE - 1);
    if (mine !== latest.current) return;
    if (error) setError(error.message);
    const ids = (data ?? []).map((t: any) => t.id);
    const { data: kids } = ids.length
      ? await supabase.from('tt_tasks').select('id, title, status, priority, due_date, start_date, parent_task_id, tt_task_assignees(user_id)').in('parent_task_id', ids).is('archived_at', null).order('start_date', { nullsFirst: false })
      : { data: [] as any[] };
    if (mine !== latest.current) return;
    const bySub: Record<string, any[]> = {};
    for (const k of kids ?? []) (bySub[k.parent_task_id] ??= []).push(k);
    setSubs(bySub);
    setRows(data ?? []); setTotal(count ?? 0); setLoading(false);
    setSelected((s) => (quiet ? s.filter((x) => ids.includes(x)) : []));
  }, [query, page]);
  useEffect(() => { load(); }, [load]);
  useLive(['tt_tasks', 'tt_task_assignees'], () => load(true));



  async function bulk(patch: object) {
    const { error } = await supabase.from('tt_tasks').update(patch).in('id', selected);
    if (error) return setError(error.message);
    load();
  }
  // same steps as deleting one task: subtasks and repeat copies point at these tasks without cascade
  async function remove() {
    const n = selected.length;
    if (!(await ask({ title: `Delete ${n} task${n > 1 ? 's' : ''}?`, message: `${n > 1 ? 'They' : 'It'} will be permanently deleted with subtasks, comments, files and history. This can't be undone.`, confirmLabel: 'Delete', danger: true })).ok) return;
    for (const step of [
      () => supabase.from('tt_tasks').delete().in('parent_task_id', selected),
      () => supabase.from('tt_tasks').update({ recurrence_parent_id: null }).in('recurrence_parent_id', selected),
      () => supabase.from('tt_tasks').delete().in('id', selected),
    ]) {
      const { error } = await step();
      if (error) return setError(error.message);
    }
    setSelected([]);
    load();
  }

  const title = mode === 'mine' ? 'My Tasks' : 'Tasks';
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const names = (t: any) => (t.tt_task_assignees ?? []).map((a: any) => name(a.user_id)).join(', ') || 'Unassigned';

  return (
    <div className="card">
      <div className="row">
        <h2>{title}</h2>
        <span className="row-actions">
          {canWrite && <button onClick={() => setShowForm(true)}>New task</button>}
        </span>
      </div>
      {showForm && (
        <dialog ref={sheet} className="nt-sheet" aria-labelledby="nt-title" onCancel={(e) => { e.preventDefault(); setShowForm(false); }}>
          <div className="nt-sheet-head">
            <h3 id="nt-title">New task</h3>
            <button type="button" className="icon-btn" aria-label="Close" onClick={() => setShowForm(false)}><X size={18} aria-hidden="true" /></button>
          </div>
          <NewTaskForm onCancel={() => setShowForm(false)} onDone={() => { setShowForm(false); load(); }} />
        </dialog>
      )}
      <div className="row filters">
        <input aria-label="Search tasks by title" placeholder="Search title" value={q} onChange={(e) => { setPage(0); setQ(e.target.value); }} />
        <select aria-label="Task view" value={view} onChange={(e) => { setPage(0); setView(e.target.value); }}>{VIEWS.map((v) => <option key={v} value={v}>{label(v)}</option>)}</select>
        <select aria-label="Filter by priority" value={priority} onChange={(e) => { setPage(0); setPriority(e.target.value); }}><option value="">Any priority</option>{PRIORITIES.map((p) => <option key={p} value={p}>{label(p)}</option>)}</select>
      </div>
      {canWrite && selected.length > 0 && (
        <div className="row filters">
          <span>{selected.length} selected</span>
          <button onClick={async () => { if ((await ask({ title: `Archive ${selected.length} task${selected.length > 1 ? 's' : ''}?`, message: 'They will be hidden from lists, the calendar and the dashboard. You can restore them from the Archived view.', confirmLabel: 'Archive', danger: true })).ok) bulk({ archived_at: new Date().toISOString() }); }}>Archive</button>
          <button onClick={() => bulk({ archived_at: null })}>Restore</button>
          <button className="danger" onClick={remove}>Delete</button>
          {PRIORITIES.map((p) => <button key={p} className="link" onClick={() => bulk({ priority: p })}>Set {label(p)}</button>)}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {loading ? <ListSkeleton /> : rows.length === 0 ? <p>No tasks match.{canWrite && ' Use “New task” to create one.'}</p> : (
        <table>
          <thead><tr>{canWrite && <th />}<th className="col-title">Title</th><th>Status</th><th className="col-opt">Priority</th><th>Assignees</th><th className="col-opt">Department</th><th>Due</th></tr></thead>
          <tbody>{rows.map((t) => {
            const kids = subs[t.id] ?? [], isOpen = open.has(t.id), done = kids.filter((k) => !isOpenStatus(k.status)).length;
            return (
              <Fragment key={t.id}>
                <tr className={isOpen ? 'has-open' : ''}>
                  {canWrite && <td><input type="checkbox" aria-label="Select" checked={selected.includes(t.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, t.id] : selected.filter((x) => x !== t.id))} /></td>}
                  <td>
                    <span className="task-title">
                      {kids.length > 0
                        ? <button type="button" className={`expand ${isOpen ? 'on' : ''}`} aria-expanded={isOpen} aria-controls={`subs-${t.id}`} aria-label={`${isOpen ? 'Hide' : 'Show'} ${kids.length} subtasks of ${t.title}`} onClick={() => toggle(t.id)}><ChevronRight size={16} aria-hidden="true" /></button>
                        : <span className="expand-gap" aria-hidden="true" />}
                      <Link to={`/tasks/${t.id}`} className="title-clamp" title={t.title}>{t.title}</Link>
                      {t.start_date && new Date(t.start_date) > new Date() && <span className="future-chip" title="Future task">Starts {new Date(t.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                      {kids.length > 0 && <button type="button" className="sub-count" onClick={() => toggle(t.id)} title="Subtasks done"><ListTree size={13} aria-hidden="true" />{done}/{kids.length}</button>}
                    </span>
                  </td>
                  <td><Badge v={t.status} /></td><td className="col-opt">{label(t.priority)}</td>
                  <td>{names(t)}</td><td className="col-opt">{t.departments?.name ?? '—'}</td>
                  <td><Due t={t} /></td>
                </tr>
                {isOpen && kids.map((k, i) => (
                  <tr key={k.id} id={i === 0 ? `subs-${t.id}` : undefined} className="sub-row" style={{ '--i': i } as React.CSSProperties}>
                    {canWrite && <td />}
                    <td><span className="task-title sub"><span className="sub-line" aria-hidden="true" /><span className={`sub-dot ${k.status}`} aria-hidden="true" /><Link to={`/tasks/${k.id}`} className="title-clamp" title={k.title}>{k.title}</Link></span></td>
                    <td><Badge v={k.status} /></td><td className="col-opt">{label(k.priority)}</td>
                    <td>{names(k)}</td><td className="muted col-opt">Subtask {i + 1} of {kids.length}</td>
                    <td>{k.start_date && new Date(k.start_date) > new Date() ? <small className="muted">Starts {new Date(k.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</small> : <Due t={k} />}</td>
                  </tr>
                ))}
              </Fragment>
            );
          })}</tbody>
        </table>
      )}
      {(
        <div className="row">
          <button disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</button>
          <span>Page {page + 1} of {pages} ({total})</span>
          <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
