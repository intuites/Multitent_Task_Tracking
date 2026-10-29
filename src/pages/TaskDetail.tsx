import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Archive, ArchiveRestore, ArrowDown, ArrowLeft, ArrowUp, Building2, CalendarClock, Eye, FolderKanban, ListChecks, Pencil, Plus, Send, Siren, Trash2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { canTransition, TASK_STATUSES, type TaskStatus } from '../../api/_lib/taskStatus';
import { Badge, dateToTs, fmt, fmtTime, isOverdue, label, rpc, usePeople } from '../lib/ui';
import FilePanel from '../components/FilePanel';
import { ask } from '../components/Dialog';
import { PageSkeleton } from '../components/Skeleton';
import { initials } from '../components/Frame';

const toDateInput = (d?: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');

export default function TaskDetail() {
  const { id } = useParams();
  const { membership, session } = useAuth();
  const orgId = membership!.org_id, uid = session!.user.id, role = membership!.role;
  const manager = can(role, 'task:write');
  const { active, name } = usePeople(orgId);
  const [t, setT] = useState<any>(null);
  const [d, setD] = useState<any>({ assignees: [], checklist: [], blockedBy: [], blocks: [], comments: [], history: [], esc: [], activity: [], contacts: [], recur: null });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(false);
  const [escForm, setEscForm] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [otherTasks, setOtherTasks] = useState<any[]>([]);

  const load = useCallback(async () => {
    const tr = await supabase.from('tt_tasks').select('*, clients:tt_clients(name), projects:tt_projects(name)').eq('id', id!).eq('org_id', orgId).maybeSingle();
    setT(tr.data);
    if (tr.data) {
      const q = (tbl: string) => supabase.from(tbl).select('*');
      const [as, ck, dp, db, cm, hi, es, ac, rc] = await Promise.all([
        q('tt_task_assignees').eq('task_id', id!),
        q('tt_task_checklist_items').eq('task_id', id!).order('position'),
        q('tt_task_dependencies').eq('task_id', id!), q('tt_task_dependencies').eq('blocked_by_id', id!),
        q('tt_task_comments').eq('task_id', id!).order('created_at'),
        q('tt_task_status_history').eq('task_id', id!).order('changed_at', { ascending: false }),
        q('tt_escalations').eq('task_id', id!).order('raised_at', { ascending: false }),
        q('tt_activity_logs').eq('entity_type', 'task').eq('entity_id', id!).order('created_at', { ascending: false }).limit(30),
        q('tt_task_recurrence').eq('task_id', id!).maybeSingle(),
      ]);
      const depIds = [...(dp.data ?? []).map((x: any) => x.blocked_by_id), ...(db.data ?? []).map((x: any) => x.task_id)];
      const { data: dt } = depIds.length ? await supabase.from('tt_tasks').select('id, title, status').in('id', depIds) : { data: [] as any[] };
      const tm = new Map((dt ?? []).map((x: any) => [x.id, x]));
      setD({
        assignees: as.data ?? [], checklist: ck.data ?? [],
        blockedBy: (dp.data ?? []).map((x: any) => tm.get(x.blocked_by_id)).filter(Boolean),
        blocks: (db.data ?? []).map((x: any) => tm.get(x.task_id)).filter(Boolean),
        comments: cm.data ?? [], history: hi.data ?? [], esc: es.data ?? [], activity: ac.data ?? [], recur: rc.data,
      });
    }
    setLoading(false);
  }, [id, orgId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (manager) supabase.from('tt_tasks').select('id, title').eq('org_id', orgId).neq('id', id!).is('archived_at', null).order('created_at', { ascending: false }).limit(200).then(({ data }) => setOtherTasks(data ?? []));
  }, [manager, orgId, id]);

  // run an action, show its error, reload
  async function run(fn: () => Promise<unknown>) {
    try { setError(''); await fn(); await load(); } catch (x) { setError((x as Error).message); }
  }
  const must = async (p: PromiseLike<{ error: { message: string } | null }>) => { const { error } = await p; if (error) throw new Error(error.message); };

  if (loading) return <PageSkeleton />;
  if (!t) return <div className="card">Task not found. <Link to="/tasks">Back to tasks</Link></div>;

  const isAssignee = d.assignees.some((a: any) => a.user_id === uid);
  const canStatus = manager || isAssignee;
  const nexts = TASK_STATUSES.filter((s) => canTransition(t.status as TaskStatus, s) && s !== 'escalation');
  const canClientComment = t.client_visible && !!t.client_id;
  const openEsc = d.esc.find((e: any) => !['resolved', 'closed'].includes(e.state));
  const unassigned = active.filter((p) => !d.assignees.some((a: any) => a.user_id === p.id));

  const changeStatus = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    run(() => rpc('tt_set_task_status', { p_task: id, p_to: f.get('to'), p_reason: String(f.get('reason')) || null, p_override: f.get('override') === 'on' }));
  };
  const saveEdit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    run(async () => {
      await must(supabase.from('tt_tasks').update({
        title: String(f.get('title')).trim(), description: String(f.get('description')).trim() || null, priority: f.get('priority'),
        start_date: dateToTs(f.get('start_date')), due_date: dateToTs(f.get('due_date')),
        estimated_hours: f.get('estimated_hours') ? Number(f.get('estimated_hours')) : null,
        actual_hours: f.get('actual_hours') ? Number(f.get('actual_hours')) : null,
        tags: String(f.get('tags')).split(',').map((s) => s.trim()).filter(Boolean),
        client_visible: f.get('client_visible') === 'on',
      }).eq('id', id!));
      await supabase.from('tt_activity_logs').insert({ org_id: orgId, actor_id: uid, entity_type: 'task', entity_id: id, action: 'edited' });
      setEdit(false);
    });
  };
  const raise = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    run(async () => {
      await rpc('tt_raise_escalation', {
        p_task: id, p_reason: f.get('reason'), p_description: String(f.get('description')) || null, p_severity: f.get('severity'),
        p_owner: f.get('owner') || null, p_target: dateToTs(f.get('target')),
      });
      setEscForm(false);
    });
  };
  const addComment = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget, f = new FormData(form);
    run(async () => {
      await must(supabase.from('tt_task_comments').insert({ org_id: orgId, task_id: id, user_id: uid, body: String(f.get('body')).trim(), visibility: f.get('visibility') || 'internal' }));
      form.reset();
    });
  };
  const addItem = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget, title = String(new FormData(form).get('title')).trim();
    if (!title) return;
    run(async () => {
      await must(supabase.from('tt_task_checklist_items').insert({ org_id: orgId, task_id: id, title, position: d.checklist.length }));
      form.reset();
    });
  };
  const move = (i: number, dir: -1 | 1) => run(async () => {
    const a = d.checklist[i], b = d.checklist[i + dir];
    if (!b) return;
    await must(supabase.from('tt_task_checklist_items').update({ position: b.position }).eq('id', a.id));
    await must(supabase.from('tt_task_checklist_items').update({ position: a.position }).eq('id', b.id));
  });

  // destructive actions always ask first
  const confirmRun = async (title: string, message: string, confirmLabel: string, fn: () => Promise<unknown>) => {
    if ((await ask({ title, message, confirmLabel, danger: true })).ok) run(fn);
  };
  const doneCount = d.checklist.filter((c: any) => c.done).length;
  const checkPct = d.checklist.length ? Math.round((doneCount / d.checklist.length) * 100) : 0;
  const overdue = isOverdue(t);
  const dueIn = t.due_date ? Math.round((new Date(t.due_date).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5) : null;
  const dueNote = dueIn === null ? 'No due date' : ['completed', 'cancelled'].includes(t.status) ? `Due ${fmt(t.due_date)}`
    : dueIn < 0 ? `Overdue by ${-dueIn} day${dueIn === -1 ? '' : 's'}` : dueIn === 0 ? 'Due today' : `Due in ${dueIn} day${dueIn === 1 ? '' : 's'}`;
  const timeline = [
    ...d.history.map((h: any) => ({ at: h.changed_at, who: h.changed_by, text: <>{h.from_status ? <>{label(h.from_status)} → </> : 'Created as '}<b>{label(h.to_status)}</b>{h.reason && <> · “{h.reason}”</>}</>, kind: 'status' })),
    ...d.activity.filter((a: any) => a.action !== 'status_changed').map((a: any) => ({ at: a.created_at, who: a.actor_id, text: <>{label(a.action)}{a.detail?.title && <> · {a.detail.title}</>}</>, kind: 'act' })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="td">
      <Link to="/tasks" className="back-link"><ArrowLeft size={16} aria-hidden="true" />All tasks</Link>

      <header className={`card td-hero ${overdue ? 'is-overdue' : ''}`}>
        <div className="td-hero-top">
          <div className="td-badges"><Badge v={t.status} /><span className={`prio prio-${t.priority}`}>{label(t.priority)} priority</span>{t.archived_at && <span className="prio">Archived</span>}{t.client_visible && <span className="prio"><Eye size={13} aria-hidden="true" />Client can see</span>}</div>
          {manager && (
            <div className="td-actions">
              <button type="button" className="pill-btn ghost" onClick={() => setEdit(!edit)}><Pencil size={15} aria-hidden="true" />{edit ? 'Cancel edit' : 'Edit'}</button>
              {t.archived_at
                ? <button type="button" className="pill-btn ghost" onClick={() => run(() => must(supabase.from('tt_tasks').update({ archived_at: null }).eq('id', id!)))}><ArchiveRestore size={15} aria-hidden="true" />Restore</button>
                : <button type="button" className="pill-btn ghost danger-text" onClick={() => confirmRun('Archive this task?', `“${t.title}” will be hidden from task lists, the calendar and the dashboard. You can restore it from the Archived view.`, 'Archive task',
                    () => must(supabase.from('tt_tasks').update({ archived_at: new Date().toISOString() }).eq('id', id!)))}><Archive size={15} aria-hidden="true" />Archive</button>}
            </div>
          )}
        </div>
        <h2 className="td-title">{t.title}</h2>
        <div className="td-meta">
          <span className={overdue ? 'overdue' : ''}><CalendarClock size={15} aria-hidden="true" />{dueNote}</span>
          {t.clients && <Link to={`/clients/${t.client_id}`}><Building2 size={15} aria-hidden="true" />{t.clients.name}</Link>}
          {t.projects && <Link to={`/projects/${t.project_id}`}><FolderKanban size={15} aria-hidden="true" />{t.projects.name}</Link>}
          {d.checklist.length > 0 && <span><ListChecks size={15} aria-hidden="true" />{doneCount}/{d.checklist.length} checklist</span>}
        </div>
      </header>
      {error && <p role="alert" className="form-alert">{error}</p>}

      <div className="td-grid">
        <div className="td-col">
          <section className="card" aria-labelledby="ov-h">
            <h3 id="ov-h">{edit ? 'Edit task' : 'Description'}</h3>
            {edit ? (
              <form className="grid" onSubmit={saveEdit}>
                <label>Title<input name="title" defaultValue={t.title} required /></label>
                <label>Priority<select name="priority" defaultValue={t.priority}>{['low', 'medium', 'high', 'urgent'].map((p) => <option key={p} value={p}>{label(p)}</option>)}</select></label>
                <label>Start<input type="date" name="start_date" defaultValue={toDateInput(t.start_date)} /></label>
                <label>Due<input type="date" name="due_date" defaultValue={toDateInput(t.due_date)} /></label>
                <label>Estimated hours<input type="number" step="0.25" min="0" name="estimated_hours" defaultValue={t.estimated_hours ?? ''} /></label>
                <label>Actual hours<input type="number" step="0.25" min="0" name="actual_hours" defaultValue={t.actual_hours ?? ''} /></label>
                <label>Tags<input name="tags" defaultValue={t.tags.join(', ')} /></label>
                <label>Description<textarea name="description" rows={4} defaultValue={t.description ?? ''} /></label>
                <label className="inline"><input type="checkbox" name="client_visible" defaultChecked={t.client_visible} /> Visible to client</label>
                <span className="row filters"><button type="submit">Save changes</button><button type="button" className="link" onClick={() => setEdit(false)}>Cancel</button></span>
              </form>
            ) : t.description ? <p className="td-desc">{t.description}</p> : <p className="muted">No description yet.{manager && ' Use Edit to add one.'}</p>}
            {!edit && t.tags.length > 0 && <div className="tag-row">{t.tags.map((g: string) => <span key={g} className="tag">#{g}</span>)}</div>}
          </section>

          <section className="card" aria-labelledby="ck-h">
            <div className="panel-head"><h3 id="ck-h">Checklist</h3>{d.checklist.length > 0 && <small className="muted">{doneCount} of {d.checklist.length} done</small>}</div>
            {d.checklist.length > 0 && <span className="meter td-meter" role="img" aria-label={`${checkPct}% of checklist done`}><i style={{ width: `${checkPct}%` }} /></span>}
            {d.checklist.length === 0 ? <p className="muted">Break the work into steps so progress is visible.</p> : (
              <ul className="check-list">{d.checklist.map((c: any, i: number) => (
                <li key={c.id} className={c.done ? 'done' : ''}>
                  <label className="inline"><input type="checkbox" checked={c.done} onChange={(e) => run(async () => {
                    await must(supabase.from('tt_task_checklist_items').update({ done: e.target.checked, done_by: e.target.checked ? uid : null }).eq('id', c.id));
                    await supabase.from('tt_activity_logs').insert({ org_id: orgId, actor_id: uid, entity_type: 'task', entity_id: id, action: e.target.checked ? 'checklist_item_done' : 'checklist_item_reopened', detail: { title: c.title } });
                  })} /> <span>{c.title}</span></label>
                  <span className="check-tools">
                    <button type="button" className="icon-btn sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} aria-hidden="true" /></button>
                    <button type="button" className="icon-btn sm" aria-label="Move down" disabled={i === d.checklist.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} aria-hidden="true" /></button>
                    <button type="button" className="icon-btn sm danger-text" aria-label={`Delete ${c.title}`} onClick={() => confirmRun('Delete checklist item?', `“${c.title}” will be removed from this task.`, 'Delete',
                      () => must(supabase.from('tt_task_checklist_items').delete().eq('id', c.id)))}><Trash2 size={14} aria-hidden="true" /></button>
                  </span>
                </li>))}</ul>)}
            <form className="inline-add" onSubmit={addItem}><input aria-label="New checklist item" name="title" placeholder="Add a step…" /><button type="submit"><Plus size={15} aria-hidden="true" />Add</button></form>
          </section>

          <section className="card" aria-labelledby="cm-h">
            <div className="panel-head"><h3 id="cm-h">Comments</h3><small className="muted">{d.comments.filter((c: any) => !c.deleted_at).length}</small></div>
            {d.comments.length === 0 ? <p className="muted">No comments yet. Start the conversation below.</p> : (
              <ul className="thread">{d.comments.map((c: any) => {
                const who = c.author_name ?? name(c.user_id);
                return (
                  <li key={c.id} className={c.user_id === uid ? 'mine' : ''}>
                    <span className="avatar sm" aria-hidden="true">{initials(who)}</span>
                    <div className={`bubble ${c.visibility === 'client' ? 'client' : ''}`}>
                      <div className="bubble-head"><b>{who}</b><small>{fmtTime(c.created_at)}{c.edited_at && ' · edited'}</small>{c.visibility === 'client' && <span className="prio"><Eye size={12} aria-hidden="true" />Client</span>}</div>
                      {c.deleted_at ? <p className="muted"><em>Comment deleted</em></p> : editing === c.id ? (
                        <form className="grid" onSubmit={(e) => { e.preventDefault(); const body = String(new FormData(e.currentTarget).get('body')).trim(); run(async () => { await must(supabase.from('tt_task_comments').update({ body }).eq('id', c.id)); setEditing(null); }); }}>
                          <textarea name="body" defaultValue={c.body} rows={2} required />
                          <span className="row filters"><button type="submit">Save</button><button type="button" className="link" onClick={() => setEditing(null)}>Cancel</button></span>
                        </form>
                      ) : <p>{c.body}</p>}
                      {!c.deleted_at && (c.user_id === uid || manager) && editing !== c.id && (
                        <div className="bubble-tools">
                          {c.user_id === uid && <button type="button" className="link" onClick={() => setEditing(c.id)}>Edit</button>}
                          <button type="button" className="link danger-text" onClick={() => confirmRun('Delete comment?', 'It will show as “Comment deleted” to everyone on this task.', 'Delete',
                            () => must(supabase.from('tt_task_comments').update({ deleted_at: new Date().toISOString() }).eq('id', c.id)))}>Delete</button>
                        </div>)}
                    </div>
                  </li>);
              })}</ul>)}
            <form className="composer" onSubmit={addComment}>
              <textarea aria-label="Add comment" name="body" rows={2} required placeholder="Write a comment…" />
              <div className="composer-bar">
                <select aria-label="Comment visibility" name="visibility"><option value="internal">Internal only</option>{canClientComment && <option value="client">Visible to client</option>}</select>
                <button type="submit"><Send size={15} aria-hidden="true" />Post</button>
              </div>
            </form>
          </section>

          <section className="card" aria-labelledby="fl-h">
            <h3 id="fl-h">Files</h3>
            <FilePanel orgId={orgId} userId={uid} entityType="task" entityId={id!} canUpload canDelete={manager} />
          </section>

          <section className="card" aria-labelledby="tl-h">
            <h3 id="tl-h">History</h3>
            {timeline.length === 0 ? <p className="muted">No changes recorded yet.</p> : (
              <ol className="timeline">{timeline.map((x, i) => (
                <li key={i} className={x.kind}><span className="tl-dot" aria-hidden="true" /><p>{x.text}</p><small>{name(x.who)} · {fmtTime(x.at)}</small></li>))}</ol>)}
          </section>
        </div>

        <aside className="td-col">
          <section className="card td-status" aria-labelledby="st-h">
            <h3 id="st-h">Status</h3>
            {t.status === 'escalation' ? (
              <p className="note">This task is escalated{openEsc ? <> ({label(openEsc.severity)}, {label(openEsc.state)}). It returns to {label(openEsc.previous_task_status)} when the escalation is resolved on the <Link to="/escalations">Escalations</Link> page.</> : '.'}</p>
            ) : canStatus ? (
              <form className="stack" onSubmit={changeStatus}>
                <select aria-label="New status" name="to" required disabled={!nexts.length}>{nexts.map((s) => <option key={s} value={s}>Move to {label(s)}</option>)}</select>
                <input aria-label="Reason for status change" name="reason" placeholder="Reason (optional)" />
                {manager && <label className="inline"><input type="checkbox" name="override" /> Override dependency block</label>}
                <button type="submit" disabled={!nexts.length}>Update status</button>
                {!['completed', 'cancelled'].includes(t.status) && <button type="button" className="pill-btn ghost danger-text" onClick={() => setEscForm(!escForm)}><Siren size={15} aria-hidden="true" />{escForm ? 'Cancel escalation' : 'Escalate'}</button>}
              </form>
            ) : <p className="muted">Only assignees and managers can change status.</p>}
            {escForm && (
              <form className="stack esc-form" onSubmit={raise}>
                <label>Reason<input name="reason" required /></label>
                <label>Severity<select name="severity" defaultValue="medium">{['low', 'medium', 'high', 'critical'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></label>
                <label>Owner<select name="owner"><option value="">Managers (default)</option>{active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                <label>Target resolution<input type="date" name="target" /></label>
                <label>Description<textarea name="description" rows={2} /></label>
                <button type="submit" className="danger">Raise escalation</button>
              </form>
            )}
          </section>

          <section className="card" aria-labelledby="dt-h">
            <h3 id="dt-h">Details</h3>
            <dl className="facts">
              <dt>Start</dt><dd>{fmt(t.start_date)}</dd>
              <dt>Due</dt><dd className={overdue ? 'overdue' : ''}>{fmt(t.due_date)}</dd>
              <dt>Effort</dt><dd>{t.estimated_hours ?? '—'}h est · {t.actual_hours ?? '—'}h actual</dd>
              <dt>Repeats</dt><dd>{d.recur ? `${label(d.recur.frequency)} ×${d.recur.interval_n}, next ${fmt(d.recur.next_run)}${d.recur.active ? '' : ' (ended)'}` : t.recurrence_parent_id ? <Link to={`/tasks/${t.recurrence_parent_id}`}>Part of a recurring task</Link> : 'No'}</dd>
              {t.completed_at && <><dt>Completed</dt><dd>{fmtTime(t.completed_at)}<br /><small className="muted">by {name(t.completed_by)}</small></dd></>}
            </dl>
          </section>

          <section className="card" aria-labelledby="pp-h">
            <h3 id="pp-h">Assignees</h3>
            {d.assignees.length === 0 ? <p className="muted">Nobody is assigned yet.</p> : (
              <ul className="people">{d.assignees.map((a: any) => (
                <li key={a.user_id}>
                  <span className="avatar sm" aria-hidden="true">{initials(name(a.user_id))}</span><span className="grow">{name(a.user_id)}</span>
                  {manager && <button type="button" className="icon-btn sm" aria-label={`Remove ${name(a.user_id)}`} onClick={() => confirmRun('Remove assignee?', `${name(a.user_id)} will no longer be assigned to this task.`, 'Remove',
                    () => rpc('tt_assign', { p_task: id, p_user: a.user_id, p_add: false }))}><X size={14} aria-hidden="true" /></button>}
                </li>))}</ul>)}
            {manager && unassigned.length > 0 && (
              <select aria-label="Add assignee" value="" onChange={(e) => e.target.value && run(() => rpc('tt_assign', { p_task: id, p_user: e.target.value, p_add: true }))}>
                <option value="">+ Add assignee</option>{unassigned.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>)}
          </section>

          <section className="card" aria-labelledby="dp-h">
            <h3 id="dp-h">Dependencies</h3>
            <p className="facts-label">Blocked by</p>
            {d.blockedBy.length === 0 ? <p className="muted">Nothing. This task can move freely.</p> : (
              <ul className="people">{d.blockedBy.map((b: any) => (
                <li key={b.id}><Link to={`/tasks/${b.id}`} className="grow">{b.title}</Link><Badge v={b.status} />
                  {manager && <button type="button" className="icon-btn sm" aria-label={`Remove dependency on ${b.title}`} onClick={() => confirmRun('Remove dependency?', `This task will no longer wait for “${b.title}”.`, 'Remove',
                    () => must(supabase.from('tt_task_dependencies').delete().eq('task_id', id!).eq('blocked_by_id', b.id)))}><X size={14} aria-hidden="true" /></button>}
                </li>))}</ul>)}
            {d.blocks.length > 0 && <><p className="facts-label">Blocks</p><ul className="people">{d.blocks.map((b: any) => <li key={b.id}><Link to={`/tasks/${b.id}`} className="grow">{b.title}</Link><Badge v={b.status} /></li>)}</ul></>}
            {manager && (
              <select aria-label="Add dependency" value="" onChange={(e) => e.target.value && run(() => rpc('tt_add_dependency', { p_task: id, p_blocker: e.target.value }))}>
                <option value="">+ Blocked by…</option>{otherTasks.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
              </select>)}
          </section>

          {d.esc.length > 0 && (
            <section className="card" aria-labelledby="es-h">
              <h3 id="es-h">Escalations</h3>
              <ul className="people">{d.esc.map((e: any) => <li key={e.id} className="esc-row"><Badge v={e.state} /><span className="grow"><b>{label(e.severity)}</b> · {e.reason}<br /><small className="muted">{fmtTime(e.raised_at)} by {name(e.raised_by)}</small></span></li>)}</ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
