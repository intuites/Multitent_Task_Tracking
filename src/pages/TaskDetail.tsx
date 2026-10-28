import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { canTransition, TASK_STATUSES, type TaskStatus } from '../../api/_lib/taskStatus';
import { Badge, dateToTs, fmt, fmtTime, isOverdue, label, rpc, usePeople } from '../lib/ui';
import FilePanel from '../components/FilePanel';
import { ask } from '../components/Dialog';

const toDateInput = (d?: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');

export default function TaskDetail() {
  const { id } = useParams();
  const { membership, session } = useAuth();
  const orgId = membership!.org_id, uid = session!.user.id, role = membership!.role;
  const manager = can(role, 'task:write');
  const { active, name } = usePeople(orgId);
  const [t, setT] = useState<any>(null);
  const [d, setD] = useState<any>({ assignees: [], watchers: [], checklist: [], blockedBy: [], blocks: [], comments: [], history: [], esc: [], approvals: [], activity: [], contacts: [], recur: null });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(false);
  const [escForm, setEscForm] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [otherTasks, setOtherTasks] = useState<any[]>([]);

  const load = useCallback(async () => {
    const tr = await supabase.from('tt_tasks').select('*, clients(name), projects(name)').eq('id', id!).eq('org_id', orgId).maybeSingle();
    setT(tr.data);
    if (tr.data) {
      const q = (tbl: string) => supabase.from(tbl).select('*');
      const [as, wa, ck, dp, db, cm, hi, es, ap, ac, rc] = await Promise.all([
        q('tt_task_assignees').eq('task_id', id!), q('tt_task_watchers').eq('task_id', id!),
        q('tt_task_checklist_items').eq('task_id', id!).order('position'),
        q('tt_task_dependencies').eq('task_id', id!), q('tt_task_dependencies').eq('blocked_by_id', id!),
        q('tt_task_comments').eq('task_id', id!).order('created_at'),
        q('tt_task_status_history').eq('task_id', id!).order('changed_at', { ascending: false }),
        q('tt_escalations').eq('task_id', id!).order('raised_at', { ascending: false }),
        q('tt_approvals').eq('task_id', id!).order('created_at', { ascending: false }),
        q('tt_activity_logs').eq('entity_type', 'task').eq('entity_id', id!).order('created_at', { ascending: false }).limit(30),
        q('tt_task_recurrence').eq('task_id', id!).maybeSingle(),
      ]);
      const depIds = [...(dp.data ?? []).map((x: any) => x.blocked_by_id), ...(db.data ?? []).map((x: any) => x.task_id)];
      const { data: dt } = depIds.length ? await supabase.from('tt_tasks').select('id, title, status').in('id', depIds) : { data: [] as any[] };
      const tm = new Map((dt ?? []).map((x: any) => [x.id, x]));
      let contacts: any[] = [];
      if (tr.data.client_id) contacts = (await supabase.from('client_contacts').select('id, full_name').eq('client_id', tr.data.client_id).eq('can_approve', true).eq('portal_access', true)).data ?? [];
      setD({
        assignees: as.data ?? [], watchers: wa.data ?? [], checklist: ck.data ?? [],
        blockedBy: (dp.data ?? []).map((x: any) => tm.get(x.blocked_by_id)).filter(Boolean),
        blocks: (db.data ?? []).map((x: any) => tm.get(x.task_id)).filter(Boolean),
        comments: cm.data ?? [], history: hi.data ?? [], esc: es.data ?? [], approvals: ap.data ?? [], activity: ac.data ?? [], contacts, recur: rc.data,
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

  if (loading) return <div className="card">Loading…</div>;
  if (!t) return <div className="card">Task not found. <Link to="/tasks">Back to tasks</Link></div>;

  const isAssignee = d.assignees.some((a: any) => a.user_id === uid);
  const canStatus = manager || isAssignee;
  const nexts = TASK_STATUSES.filter((s) => canTransition(t.status as TaskStatus, s) && s !== 'escalation');
  const watching = d.watchers.some((w: any) => w.user_id === uid);
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
        client_visible: f.get('client_visible') === 'on', requires_approval: f.get('requires_approval') === 'on',
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
  const requestApproval = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = String(new FormData(e.currentTarget).get('approver'));
    run(() => rpc('tt_request_approval', v.startsWith('c:') ? { p_task: id, p_contact: v.slice(2) } : { p_task: id, p_user: v }));
  };

  return (
    <div className="card">
      <div className="row">
        <h2>{t.title} <Badge v={t.status} /></h2>
        <span>
          {manager && <button className="link" onClick={() => setEdit(!edit)}>{edit ? 'Cancel edit' : 'Edit'}</button>}
          {manager && <button className="link" onClick={() => run(() => must(supabase.from('tt_tasks').update({ archived_at: t.archived_at ? null : new Date().toISOString() }).eq('id', id!)))}>{t.archived_at ? 'Restore' : 'Archive'}</button>}
        </span>
      </div>
      {error && <p role="alert">{error}</p>}

      {edit ? (
        <form className="grid" onSubmit={saveEdit}>
          <label>Title<input name="title" defaultValue={t.title} required /></label>
          <label>Priority<select name="priority" defaultValue={t.priority}>{['low', 'medium', 'high', 'urgent'].map((p) => <option key={p} value={p}>{label(p)}</option>)}</select></label>
          <label>Start<input type="date" name="start_date" defaultValue={toDateInput(t.start_date)} /></label>
          <label>Due<input type="date" name="due_date" defaultValue={toDateInput(t.due_date)} /></label>
          <label>Estimated hours<input type="number" step="0.25" min="0" name="estimated_hours" defaultValue={t.estimated_hours ?? ''} /></label>
          <label>Actual hours<input type="number" step="0.25" min="0" name="actual_hours" defaultValue={t.actual_hours ?? ''} /></label>
          <label>Tags<input name="tags" defaultValue={t.tags.join(', ')} /></label>
          <label>Description<textarea name="description" rows={3} defaultValue={t.description ?? ''} /></label>
          <label className="inline"><input type="checkbox" name="client_visible" defaultChecked={t.client_visible} /> Visible to client</label>
          <label className="inline"><input type="checkbox" name="requires_approval" defaultChecked={t.requires_approval} /> Requires approval</label>
          <button type="submit">Save</button>
        </form>
      ) : (
        <dl>
          <dt>Description</dt><dd>{t.description ?? '—'}</dd>
          <dt>Priority</dt><dd>{label(t.priority)}</dd>
          <dt>Dates</dt><dd>{fmt(t.start_date)} → <span className={isOverdue(t) ? 'overdue' : ''}>{fmt(t.due_date)}{isOverdue(t) && ' (overdue)'}</span></dd>
          <dt>Effort</dt><dd>{t.estimated_hours ?? '—'}h est. / {t.actual_hours ?? '—'}h actual</dd>
          <dt>Client</dt><dd>{t.clients ? <Link to={`/clients/${t.client_id}`}>{t.clients.name}</Link> : '—'}</dd>
          <dt>Project</dt><dd>{t.projects ? <Link to={`/projects/${t.project_id}`}>{t.projects.name}</Link> : '—'}</dd>
          <dt>Tags</dt><dd>{t.tags.join(', ') || '—'}</dd>
          <dt>Flags</dt><dd>{[t.client_visible && 'client-visible', t.requires_approval && 'needs approval', t.archived_at && 'archived'].filter(Boolean).join(', ') || '—'}</dd>
          <dt>Repeats</dt><dd>{d.recur ? `${d.recur.frequency} ×${d.recur.interval_n}, next ${fmt(d.recur.next_run)}${d.recur.active ? '' : ' (ended)'}` : t.recurrence_parent_id ? <>occurrence of <Link to={`/tasks/${t.recurrence_parent_id}`}>recurring task</Link></> : 'No'}</dd>
          {t.completed_at && <><dt>Completed</dt><dd>{fmtTime(t.completed_at)} by {name(t.completed_by)}</dd></>}
        </dl>
      )}

      <h3>Status</h3>
      {t.status === 'escalation' ? (
        <p>This task is escalated{openEsc ? <> ({label(openEsc.severity)}, {label(openEsc.state)}) — it returns to normal only when the escalation is resolved on the <Link to="/escalations">Escalations</Link> page. Previous status: {label(openEsc.previous_task_status)}.</> : '.'}</p>
      ) : canStatus && (nexts.length || true) ? (
        <form className="row filters" onSubmit={changeStatus}>
          <select aria-label="New status" name="to" required>{nexts.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
          <input aria-label="Reason for status change" name="reason" placeholder="Reason (optional)" />
          {manager && <label className="inline"><input type="checkbox" name="override" /> Override dependency block</label>}
          <button type="submit" disabled={!nexts.length}>Change status</button>
          {!['completed', 'cancelled'].includes(t.status) && <button type="button" className="danger" onClick={() => setEscForm(!escForm)}>Escalate</button>}
        </form>
      ) : <p>Only assignees and managers can change status.</p>}
      {escForm && (
        <form className="grid" onSubmit={raise}>
          <label>Reason (required)<input name="reason" required /></label>
          <label>Severity<select name="severity" defaultValue="medium">{['low', 'medium', 'high', 'critical'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></label>
          <label>Owner<select name="owner"><option value="">Managers (default)</option>{active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Target resolution<input type="date" name="target" /></label>
          <label>Description<textarea name="description" rows={2} /></label>
          <button type="submit" className="danger">Raise escalation</button>
        </form>
      )}

      <h3>People</h3>
      <p>Assignees: {d.assignees.length === 0 ? 'none' : d.assignees.map((a: any) => (
        <span key={a.user_id} className="chip">{name(a.user_id)}{manager && <button className="link" aria-label={`Remove ${name(a.user_id)}`} onClick={() => run(() => rpc('tt_assign', { p_task: id, p_user: a.user_id, p_add: false }))}>×</button>}</span>))}</p>
      {manager && unassigned.length > 0 && (
        <select aria-label="Add assignee" value="" onChange={(e) => e.target.value && run(() => rpc('tt_assign', { p_task: id, p_user: e.target.value, p_add: true }))}>
          <option value="">+ Add assignee</option>{unassigned.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>)}
      <p>Watchers: {d.watchers.map((w: any) => name(w.user_id)).join(', ') || 'none'}{' '}
        <button className="link" onClick={() => run(() => must(watching
          ? supabase.from('tt_task_watchers').delete().eq('task_id', id!).eq('user_id', uid)
          : supabase.from('tt_task_watchers').insert({ task_id: id, user_id: uid })))}>{watching ? 'Stop watching' : 'Watch'}</button></p>

      <h3>Checklist</h3>
      {d.checklist.length === 0 ? <p>No checklist items.</p> : (
        <ul className="plain">{d.checklist.map((c: any, i: number) => (
          <li key={c.id}>
            <label className="inline"><input type="checkbox" checked={c.done} onChange={(e) => run(async () => {
              await must(supabase.from('tt_task_checklist_items').update({ done: e.target.checked, done_by: e.target.checked ? uid : null }).eq('id', c.id));
              await supabase.from('tt_activity_logs').insert({ org_id: orgId, actor_id: uid, entity_type: 'task', entity_id: id, action: e.target.checked ? 'checklist_item_done' : 'checklist_item_reopened', detail: { title: c.title } });
            })} /> {c.title}</label>
            <button className="link" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
            <button className="link" aria-label="Move down" disabled={i === d.checklist.length - 1} onClick={() => move(i, 1)}>↓</button>
            <button className="link" onClick={() => run(() => must(supabase.from('tt_task_checklist_items').delete().eq('id', c.id)))}>Delete</button>
          </li>))}</ul>)}
      <form className="row filters" onSubmit={addItem}><input aria-label="New checklist item" name="title" placeholder="New item" /><button type="submit">Add</button></form>

      <h3>Dependencies</h3>
      <p>Blocked by: {d.blockedBy.length === 0 ? 'none' : d.blockedBy.map((b: any) => (
        <span key={b.id} className="chip"><Link to={`/tasks/${b.id}`}>{b.title}</Link> <Badge v={b.status} />
          {manager && <button className="link" aria-label="Remove dependency" onClick={() => run(() => must(supabase.from('tt_task_dependencies').delete().eq('task_id', id!).eq('blocked_by_id', b.id)))}>×</button>}</span>))}</p>
      <p>Blocks: {d.blocks.length === 0 ? 'none' : d.blocks.map((b: any) => <span key={b.id} className="chip"><Link to={`/tasks/${b.id}`}>{b.title}</Link></span>)}</p>
      {manager && (
        <select aria-label="Add dependency" value="" onChange={(e) => e.target.value && run(() => rpc('tt_add_dependency', { p_task: id, p_blocker: e.target.value }))}>
          <option value="">+ Blocked by…</option>{otherTasks.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
        </select>)}

      <h3>Comments</h3>
      {d.comments.length === 0 ? <p>No comments yet.</p> : d.comments.map((c: any) => (
        <div key={c.id} className={`note ${c.visibility === 'client' ? 'client' : ''}`}>
          <strong>{c.author_name ?? name(c.user_id)}</strong> <small>{fmtTime(c.created_at)}{c.edited_at && ' (edited)'} · {c.visibility === 'client' ? 'visible to client' : 'internal'}</small>
          {c.deleted_at ? <p><em>Deleted</em></p> : editing === c.id ? (
            <form onSubmit={(e) => { e.preventDefault(); const body = String(new FormData(e.currentTarget).get('body')).trim(); run(async () => { await must(supabase.from('tt_task_comments').update({ body }).eq('id', c.id)); setEditing(null); }); }}>
              <textarea name="body" defaultValue={c.body} rows={2} required /><button type="submit">Save</button><button type="button" className="link" onClick={() => setEditing(null)}>Cancel</button>
            </form>
          ) : <p>{c.body}</p>}
          {!c.deleted_at && (c.user_id === uid || manager) && editing !== c.id && (
            <>{c.user_id === uid && <button className="link" onClick={() => setEditing(c.id)}>Edit</button>}
              <button className="link" onClick={async () => { if ((await ask({ message: 'Delete this comment? It will show as deleted.', confirmLabel: 'Delete', danger: true })).ok) run(() => must(supabase.from('tt_task_comments').update({ deleted_at: new Date().toISOString() }).eq('id', c.id))); }}>Delete</button></>)}
        </div>))}
      <form className="grid" onSubmit={addComment}>
        <label>Add comment<textarea name="body" rows={2} required /></label>
        <label>Visibility<select name="visibility"><option value="internal">Internal only</option>{canClientComment && <option value="client">Visible to client</option>}</select></label>
        <button type="submit">Post</button>
      </form>

      <h3>Files</h3>
      <FilePanel orgId={orgId} userId={uid} entityType="task" entityId={id!} canUpload canDelete={manager} />

      <h3>Approvals</h3>
      {d.approvals.length === 0 ? <p>None.</p> : <ul className="plain">{d.approvals.map((a: any) => (
        <li key={a.id}>{a.approver_contact_id ? `Client contact ${d.contacts.find((c: any) => c.id === a.approver_contact_id)?.full_name ?? ''}` : name(a.approver_user_id)} — <Badge v={a.status} />{a.comment && ` “${a.comment}”`}
          {a.status === 'pending' && a.approver_user_id === uid && (<>
            <button onClick={() => run(() => rpc('tt_decide_approval', { p_id: a.id, p_approve: true }))}>Approve</button>
            <button className="danger" onClick={async () => { const r = await ask({ title: 'Reject approval', message: 'Say why, so the team can address it.', input: 'Reason', confirmLabel: 'Reject', danger: true }); if (r.ok) run(() => rpc('tt_decide_approval', { p_id: a.id, p_approve: false, p_comment: r.value })); }}>Reject</button></>)}
        </li>))}</ul>}
      {manager && (
        <form className="row filters" onSubmit={requestApproval}>
          <select aria-label="Approver" name="approver" required><option value="">Request approval from…</option>
            {active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            {d.contacts.map((c: any) => <option key={c.id} value={`c:${c.id}`}>Client: {c.full_name}</option>)}</select>
          <button type="submit">Request</button>
        </form>)}

      <h3>Escalations</h3>
      {d.esc.length === 0 ? <p>None.</p> : <ul className="plain">{d.esc.map((e: any) => <li key={e.id}><Badge v={e.state} /> {label(e.severity)} — {e.reason} <small>raised {fmtTime(e.raised_at)} by {name(e.raised_by)}</small></li>)}</ul>}

      <h3>Status history</h3>
      <ul className="plain">{d.history.map((h: any) => <li key={h.id}>{h.from_status ? label(h.from_status) : 'Created'} → {label(h.to_status)} by {name(h.changed_by)} <small>{fmtTime(h.changed_at)}</small>{h.reason && <> — {h.reason}</>}</li>)}</ul>
      <h3>Activity</h3>
      <ul className="plain">{d.activity.map((a: any) => <li key={a.id}>{label(a.action)} by {name(a.actor_id)} <small>{fmtTime(a.created_at)}</small></li>)}</ul>
    </div>
  );
}
