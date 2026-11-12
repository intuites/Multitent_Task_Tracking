import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore, ChevronLeft, ChevronRight, ListTree, Plus, Search, Trash2, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { TASK_STATUSES } from '../../api/_lib/taskStatus';
import { Badge, Due, fetchAll, isOpen as isOpenStatus, label, usePeople } from '../lib/ui';
import { Avatar } from '../components/Frame';
import { ListSkeleton } from '../components/Skeleton';
import { ask } from '../components/Dialog';
import NewTaskForm from '../components/NewTaskForm';
import { useLive } from '../lib/live';
import { Count } from '../stageshow/kit/motion';
import { Segmented } from '../stageshow/kit/controls';
import './tasks.css';

export type Mode = 'all' | 'mine';
const PAGE = 25;
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const VIEWS = ['all', 'unassigned', ...TASK_STATUSES.filter((s) => s !== 'escalation'), 'overdue', 'due_today', 'upcoming', 'archived'];
// the views people use most, as tabs with live counts; the rest stay in the "More views" menu
const TABS = ['all', 'not_yet_started', 'started', 'pending', 'overdue', 'completed'] as const;
const OPEN = '(completed,completed_cycle)';

export default function Tasks({ mode }: { mode: Mode }) {
  const { membership, session } = useAuth();
  const orgId = membership!.org_id, uid = session!.user.id;
  const canWrite = can(membership!.role, 'task:write');
  const { name, photo } = usePeople(orgId);
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [view, setView] = useState(params.get('view') ?? 'all');
  const [q, setQ] = useState('');
  const [priority, setPriority] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  // every task matching the filters is selected, across pages (Select all N matching)
  const [everything, setEverything] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tabCount, setTabCount] = useState<Record<string, number> | null>(null);
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

  // the list's filters without the view: what the tabs count over
  const base = useCallback((cols: string, count = false) => {
    // My Tasks filters on a second copy ("mine"), so the Assignees column still lists everyone on the task
    let qy = supabase.from('tt_tasks')
      .select(`${cols}${mode === 'mine' ? ', mine:tt_task_assignees!inner(user_id)' : ''}`, count ? { count: 'exact' } : undefined)
      .eq('org_id', orgId);
    if (mode === 'mine') qy = qy.eq('mine.user_id', uid);
    if (q.trim()) qy = qy.ilike('title', `%${q.trim().replace(/[%,()*]/g, ' ')}%`);
    if (priority) qy = qy.eq('priority', priority);
    // on the main list subtasks sit under their parent; My Tasks still list them so people see their own work
    if (mode === 'all' && !q.trim()) qy = qy.is('parent_task_id', null);
    return qy;
  }, [orgId, uid, mode, q, priority]);

  // the list's query (filters + view + order, no paging), shared by the page and by Select all
  const query = useCallback((cols = '*, departments:tt_departments(name), tt_task_assignees(user_id)', count = false) => {
    let qy = base(cols, count);
    const now = new Date(), start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    const week = new Date(start); week.setDate(week.getDate() + 8);
    if (view === 'archived') qy = qy.not('archived_at', 'is', null);
    else qy = qy.is('archived_at', null);
    if (view === 'unassigned') qy = qy.is('tt_task_assignees', null);
    else if (view === 'overdue') qy = qy.lt('due_date', now.toISOString()).not('status', 'in', OPEN);
    else if (view === 'due_today') qy = qy.gte('due_date', start.toISOString()).lt('due_date', end.toISOString()).not('status', 'in', OPEN);
    else if (view === 'upcoming') qy = qy.gte('due_date', end.toISOString()).lt('due_date', week.toISOString()).not('status', 'in', OPEN);
    else if ((TASK_STATUSES as readonly string[]).includes(view)) qy = qy.eq('status', view);
    return qy.order(view === 'overdue' || view === 'upcoming' ? 'due_date' : 'created_at', { ascending: view === 'overdue' || view === 'upcoming' }).order('id');
  }, [base, view]);

  // a new filter or view starts a fresh selection
  useEffect(() => { setEverything(false); setSelected([]); }, [query]);

  // quiet = a live refresh: no skeleton flash, and ticked rows stay ticked
  const latest = useRef(0);
  const everythingRef = useRef(everything);
  everythingRef.current = everything;
  const load = useCallback(async (quiet = false) => {
    const mine = ++latest.current; // a slower, older search must not overwrite a newer one
    if (!quiet) setLoading(true);
    setError('');
    const [{ data, count, error }, counted] = await Promise.all([
      query(undefined, true).range(page * PAGE, page * PAGE + PAGE - 1),
      fetchAll(() => base('id, status, due_date').is('archived_at', null).order('id')).catch(() => null),
    ]);
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
    if (counted) {
      const now = Date.now(), c: Record<string, number> = { all: counted.length, overdue: 0 };
      for (const t of counted as any[]) {
        c[t.status] = (c[t.status] ?? 0) + 1;
        if (isOpenStatus(t.status) && t.due_date && Date.parse(t.due_date) < now) c.overdue++;
      }
      setTabCount(c);
    }
    // a page turn keeps an all-matching selection; otherwise only rows still on screen stay ticked
    setSelected((s) => (everythingRef.current ? s : quiet ? s.filter((x) => ids.includes(x)) : []));
  }, [query, base, page]);
  useEffect(() => { load(); }, [load]);
  useLive(['tt_tasks', 'tt_task_assignees'], () => load(true));

  const clear = () => { setSelected([]); setEverything(false); };
  // Esc clears a selection (unless a dialog or menu has it)
  useEffect(() => {
    if (!selected.length) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) clear(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [selected.length]);

  const pageIds = rows.map((t) => t.id);
  const onPage = pageIds.filter((id) => selected.includes(id)).length;
  const allOnPage = pageIds.length > 0 && onPage === pageIds.length;
  const headBox = useRef<HTMLInputElement>(null);
  useEffect(() => { if (headBox.current) headBox.current.indeterminate = onPage > 0 && !allOnPage; }, [onPage, allOnPage]);
  const togglePage = () => {
    setEverything(false);
    setSelected((s) => (allOnPage ? s.filter((x) => !pageIds.includes(x)) : [...new Set([...s, ...pageIds])]));
  };
  async function selectEverything() {
    setBusy(true);
    try {
      const all = await fetchAll(() => query('id'));
      setSelected(all.map((t: any) => t.id)); setEverything(true);
    } catch (x) { setError((x as Error).message); }
    setBusy(false);
  }

  // updates go in slices, so a few thousand selected tasks never make one oversized request
  const slices = (ids: string[]) => Array.from({ length: Math.ceil(ids.length / 200) }, (_, i) => ids.slice(i * 200, i * 200 + 200));
  async function bulk(patch: object) {
    setBusy(true);
    for (const ids of slices(selected)) {
      const { error } = await supabase.from('tt_tasks').update(patch).in('id', ids);
      if (error) { setBusy(false); return setError(error.message); }
    }
    setBusy(false); clear(); load();
  }
  // same steps as deleting one task: subtasks and repeat copies point at these tasks without cascade
  async function remove() {
    const n = selected.length;
    if (!(await ask({ title: `Delete ${n} task${n > 1 ? 's' : ''}?`, message: `${n > 1 ? 'They' : 'It'} will be permanently deleted with subtasks, comments, files and history. This can't be undone.`, confirmLabel: 'Delete', danger: true })).ok) return;
    setBusy(true);
    for (const ids of slices(selected)) {
      for (const step of [
        () => supabase.from('tt_tasks').delete().in('parent_task_id', ids),
        () => supabase.from('tt_tasks').update({ recurrence_parent_id: null }).in('recurrence_parent_id', ids),
        () => supabase.from('tt_tasks').delete().in('id', ids),
      ]) {
        const { error } = await step();
        if (error) { setBusy(false); return setError(error.message); }
      }
    }
    setBusy(false); clear(); load();
  }
  async function archive() {
    const n = selected.length;
    if ((await ask({ title: `Archive ${n} task${n > 1 ? 's' : ''}?`, message: 'They will be hidden from lists, the calendar and the dashboard. You can restore them from the Archived view.', confirmLabel: 'Archive', danger: true })).ok) bulk({ archived_at: new Date().toISOString() });
  }

  const title = mode === 'mine' ? 'My Tasks' : 'Tasks';
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const people = (t: any) => (t.tt_task_assignees ?? []).map((a: any) => a.user_id) as string[];
  const tabIndex = (TABS as readonly string[]).indexOf(view);
  const go = (v: string) => { setPage(0); setView(v); };
  const from = total ? page * PAGE + 1 : 0, to = Math.min(total, page * PAGE + rows.length);

  return (
    <div className="tl">
      <div className="page-head">
        <div>
          <h2 className="page-title">{title}</h2>
          <p className="page-sub"><Count value={tabCount?.all ?? 0} /> {mode === 'mine' ? 'tasks assigned to you' : 'tasks in this organization'}{tabCount?.overdue ? <> · <span className="tl-warn"><Count value={tabCount.overdue} /> overdue</span></> : null}</p>
        </div>
        <div className="page-actions">
          {canWrite && <button type="button" className="pill-btn" onClick={() => setShowForm(true)}><Plus size={16} aria-hidden="true" />New task</button>}
        </div>
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

      <div className="tl-card">
        <div className="tl-tools">
          <Segmented className="tl-tabs" data-none={tabIndex < 0 || undefined} value={Math.max(0, tabIndex)}
            items={TABS.map((v) => (
              <button key={v} type="button" aria-pressed={view === v} className="tl-tab" onClick={() => go(v)}>
                {label(v)}<span className="tl-n"><Count value={tabCount?.[v] ?? 0} /></span>
              </button>
            ))} />
          <span className="tl-filters">
            <label className="tl-search"><Search size={15} aria-hidden="true" /><input aria-label="Search tasks by title" placeholder="Search title" value={q} onChange={(e) => { setPage(0); setQ(e.target.value); }} /></label>
            <select aria-label="Task view" value={tabIndex < 0 ? view : ''} onChange={(e) => go(e.target.value || 'all')}>
              <option value="">More views</option>{VIEWS.filter((v) => !(TABS as readonly string[]).includes(v)).map((v) => <option key={v} value={v}>{label(v)}</option>)}
            </select>
            <select aria-label="Filter by priority" value={priority} onChange={(e) => { setPage(0); setPriority(e.target.value); }}><option value="">Any priority</option>{PRIORITIES.map((p) => <option key={p} value={p}>{label(p)}</option>)}</select>
          </span>
        </div>

        {error && <p role="alert" className="tl-error">{error}</p>}
        {loading ? <ListSkeleton /> : rows.length === 0 ? (
          <div className="tl-empty"><ListTree size={28} aria-hidden="true" /><b>No tasks match</b><span>{q || priority || view !== 'all' ? 'Try another view or clear the search.' : canWrite ? 'Use “New task” to create one.' : 'Nothing is assigned to you yet.'}</span></div>
        ) : (
          <div className="tl-scroll">
            <table className="tl-table">
              <thead><tr>
                {canWrite && <th className="tl-check"><input ref={headBox} type="checkbox" aria-label={allOnPage ? 'Unselect all tasks on this page' : 'Select all tasks on this page'} checked={allOnPage} onChange={togglePage} /></th>}
                <th className="col-title">Title</th><th>Status</th><th className="col-opt">Priority</th><th>Assignees</th><th className="col-opt">Department</th><th>Due</th>
              </tr></thead>
              <tbody>{rows.map((t, n) => {
                const kids = subs[t.id] ?? [], isOpen = open.has(t.id), done = kids.filter((k) => !isOpenStatus(k.status)).length, on = selected.includes(t.id);
                return (
                  <Fragment key={t.id}>
                    <tr className={`${isOpen ? 'has-open' : ''}${on ? ' tl-on' : ''}`} style={{ '--i': n } as React.CSSProperties}>
                      {canWrite && <td className="tl-check"><input type="checkbox" aria-label={`Select ${t.title}`} checked={on} onChange={(e) => { setEverything(false); setSelected(e.target.checked ? [...selected, t.id] : selected.filter((x) => x !== t.id)); }} /></td>}
                      <td>
                        <span className="task-title">
                          {kids.length > 0
                            ? <button type="button" className={`expand ${isOpen ? 'on' : ''}`} aria-expanded={isOpen} aria-controls={`subs-${t.id}`} aria-label={`${isOpen ? 'Hide' : 'Show'} ${kids.length} subtasks of ${t.title}`} onClick={() => toggle(t.id)}><ChevronRight size={16} aria-hidden="true" /></button>
                            : <span className="expand-gap" aria-hidden="true" />}
                          <Link to={`/tasks/${t.id}`} className="title-clamp" title={t.title}>{t.title}</Link>
                          {t.start_date && new Date(t.start_date) > new Date() && <span className="future-chip" title="Future task">Starts {new Date(t.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                          {kids.length > 0 && (
                            <button type="button" className="tl-subs" onClick={() => toggle(t.id)} title={`${done} of ${kids.length} subtasks done`}>
                              <span className="tl-subs-bar" aria-hidden="true"><i style={{ width: `${(done / kids.length) * 100}%` }} /></span>{done}/{kids.length}
                            </button>
                          )}
                        </span>
                      </td>
                      <td><Badge v={t.status} />{t.paused_until && <span className="paused-tag" title={`Paused until ${new Date(`${t.paused_until}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}>Paused</span>}</td>
                      <td className="col-opt"><span className="tl-pri" data-p={t.priority}>{label(t.priority)}</span></td>
                      <td><People ids={people(t)} name={name} photo={photo} /></td>
                      <td className="col-opt">{t.departments?.name ?? <span className="muted">—</span>}</td>
                      <td className="tl-due"><Due t={t} /></td>
                    </tr>
                    {isOpen && kids.map((k, i) => (
                      <tr key={k.id} id={i === 0 ? `subs-${t.id}` : undefined} className="sub-row" style={{ '--i': i } as React.CSSProperties}>
                        {canWrite && <td />}
                        <td><span className="task-title sub"><span className="sub-line" aria-hidden="true" /><span className={`sub-dot ${k.status}`} aria-hidden="true" /><Link to={`/tasks/${k.id}`} className="title-clamp" title={k.title}>{k.title}</Link></span></td>
                        <td><Badge v={k.status} /></td><td className="col-opt"><span className="tl-pri" data-p={k.priority}>{label(k.priority)}</span></td>
                        <td><People ids={people(k)} name={name} photo={photo} /></td><td className="muted col-opt">Subtask {i + 1} of {kids.length}</td>
                        <td className="tl-due">{k.start_date && new Date(k.start_date) > new Date() ? <small className="muted">Starts {new Date(k.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</small> : <Due t={k} />}</td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}</tbody>
            </table>
          </div>
        )}

        <div className="tl-foot">
          <span className="muted">{total ? `${from}–${to} of ${total}` : 'No tasks'}</span>
          <span className="tl-pager">
            <button type="button" className="icon-btn" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft size={16} aria-hidden="true" /></button>
            <span>Page {page + 1} of {pages}</span>
            <button type="button" className="icon-btn" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight size={16} aria-hidden="true" /></button>
          </span>
        </div>
      </div>

      {/* bulk actions: slides up while anything is selected */}
      {canWrite && (
        <div className="tl-bulk" data-show={selected.length > 0 || undefined} role="region" aria-label="Selected tasks" aria-hidden={!selected.length}>
          <span className="tl-bulk-n"><b><Count value={selected.length} /></b> selected</span>
          {!everything && allOnPage && total > rows.length && (
            <button type="button" className="link" onClick={selectEverything} disabled={busy}>Select all {total} matching</button>
          )}
          {everything && <span className="muted">All {selected.length} matching tasks</span>}
          <span className="tl-bulk-actions">
            {view === 'archived'
              ? <button type="button" className="pill-btn ghost sm" onClick={() => bulk({ archived_at: null })} disabled={busy}><ArchiveRestore size={15} aria-hidden="true" />Restore</button>
              : <button type="button" className="pill-btn ghost sm" onClick={archive} disabled={busy}><Archive size={15} aria-hidden="true" />Archive</button>}
            <select aria-label="Set priority of the selected tasks" value="" disabled={busy} onChange={(e) => e.target.value && bulk({ priority: e.target.value })}>
              <option value="">Set priority</option>{PRIORITIES.map((p) => <option key={p} value={p}>{label(p)}</option>)}
            </select>
            <button type="button" className="pill-btn ghost sm tl-danger" onClick={remove} disabled={busy}><Trash2 size={15} aria-hidden="true" />Delete</button>
            <button type="button" className="icon-btn" onClick={clear} aria-label="Clear selection" title="Clear selection (Esc)"><X size={16} aria-hidden="true" /></button>
          </span>
        </div>
      )}
    </div>
  );
}

/** Up to three avatars (photos where people have one), then +N; every name in the tooltip and for screen readers. */
function People({ ids, name, photo }: { ids: string[]; name: (id?: string | null) => string; photo: (id?: string | null) => string | null }) {
  if (!ids.length) return <span className="muted">Unassigned</span>;
  const all = ids.map((id) => name(id)).join(', ');
  return (
    <span className="tl-people" title={all}>
      <span className="tl-faces" aria-hidden="true">
        {ids.slice(0, 3).map((id) => <Avatar key={id} name={name(id)} url={photo(id)} className="avatar tl-face" />)}
        {ids.length > 3 && <span className="avatar tl-face tl-more">+{ids.length - 3}</span>}
      </span>
      <span className="tl-names" aria-hidden="true">{ids.length === 1 ? all : `${name(ids[0])} +${ids.length - 1}`}</span>
      <span className="sr-only">{all}</span>
    </span>
  );
}
