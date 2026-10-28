import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { projectProgress, type ProgressMode } from '../../api/_lib/progress';
import { logActivity } from '../lib/activity';
import { PROJECT_STATUSES } from './Projects';
import { ask } from '../components/Dialog';
import { fmtDay, label } from '../lib/ui';
import { PageSkeleton } from '../components/Skeleton';

export default function ProjectDetail() {
  const { id } = useParams();
  const { membership, session } = useAuth();
  const orgId = membership!.org_id;
  const uid = session!.user.id;
  const canWrite = can(membership!.role, 'project:write');
  const [p, setP] = useState<any>(null);
  const [ms, setMs] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const pr = await supabase.from('tt_projects').select('*, clients:tt_clients(name)').eq('id', id!).eq('org_id', orgId).maybeSingle();
    setP(pr.data);
    if (pr.data) {
      const [m, t] = await Promise.all([
        supabase.from('tt_project_milestones').select('*').eq('project_id', id!).order('due_date', { nullsFirst: false }),
        supabase.from('tt_tasks').select('id, title, status, due_date').eq('project_id', id!).eq('org_id', orgId),
      ]);
      setMs(m.data ?? []); setTasks(t.data ?? []);
    }
    setLoading(false);
  }, [id, orgId]);
  useEffect(() => { load(); }, [load]);

  async function update(patch: object, action: string, detail: object = {}) {
    const { error } = await supabase.from('tt_projects').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id!);
    if (error) return setError(error.message);
    await logActivity(orgId, uid, 'project', id!, action, detail);
    setError(''); load();
  }

  async function addMilestone(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const { error } = await supabase.from('tt_project_milestones').insert({
      org_id: orgId, project_id: id, title: String(f.get('title')).trim(), due_date: f.get('due_date') || null,
    });
    if (error) return setError(error.message);
    form.reset(); load();
  }

  async function toggleMilestone(m: any) {
    await supabase.from('tt_project_milestones').update({ completed_at: m.completed_at ? null : new Date().toISOString() }).eq('id', m.id);
    await logActivity(orgId, uid, 'project', id!, m.completed_at ? 'milestone_reopened' : 'milestone_completed', { title: m.title });
    load();
  }

  if (loading) return <PageSkeleton />;
  if (!p) return <div className="card">Project not found. <Link to="/projects">Back to projects</Link></div>;

  const progress = projectProgress(p.progress_mode as ProgressMode, p.manual_progress, ms, tasks);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="card">
      <div className="row">
        <h2>{p.name} <small>({p.clients?.name ?? 'no client'})</small></h2>
        {canWrite && (
          <select aria-label="Project status" value={p.status} onChange={async (e) => {
            const to = e.target.value;
            if (to === 'archived' && !(await ask({ message: 'Archive this project?', confirmLabel: 'Archive', danger: true })).ok) return;
            update({ status: to }, 'status_changed', { from: p.status, to });
          }}>{PROJECT_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      <dl>
        <dt>Priority</dt><dd>{label(p.priority)}</dd>
        <dt>Dates</dt><dd>{fmtDay(p.start_date)} → {fmtDay(p.due_date)}</dd>
        <dt>Progress</dt>
        <dd>
          <progress value={progress} max={100} /> {progress}% <small>({p.progress_mode === 'manual' ? 'entered manually' : `calculated from ${p.progress_mode}`})</small>
          {canWrite && (
            <div className="row">
              <select aria-label="Progress mode" value={p.progress_mode} onChange={(e) => update({ progress_mode: e.target.value }, 'progress_mode_changed', { to: e.target.value })}>
                <option value="milestones">Calculate from milestones</option><option value="tasks">Calculate from tasks</option><option value="manual">Enter manually</option>
              </select>
              {p.progress_mode === 'manual' && (
                <input aria-label="Manual progress percent" type="number" min={0} max={100} defaultValue={p.manual_progress}
                  onBlur={(e) => update({ manual_progress: Math.min(100, Math.max(0, Number(e.target.value) || 0)) }, 'progress_updated')} />
              )}
            </div>
          )}
        </dd>
        <dt>Client visible</dt>
        <dd>{canWrite
          ? <input type="checkbox" checked={p.client_visible} onChange={(e) => update({ client_visible: e.target.checked }, 'client_visibility_changed', { visible: e.target.checked })} />
          : String(p.client_visible)}</dd>
      </dl>

      <h3>Milestones</h3>
      {ms.length === 0 ? <p>No milestones yet.</p> : (
        <ul className="plain">{ms.map((m) => (
          <li key={m.id}>
            <label><input type="checkbox" checked={!!m.completed_at} disabled={!canWrite} onChange={() => toggleMilestone(m)} /> {m.title}</label>
            {m.due_date && <small className={!m.completed_at && m.due_date < today ? 'overdue' : ''}> due {fmtDay(m.due_date)}{!m.completed_at && m.due_date < today && ' (overdue)'}</small>}
          </li>
        ))}</ul>
      )}
      {canWrite && (
        <form className="grid" onSubmit={addMilestone}>
          <label>Title<input name="title" required /></label>
          <label>Due<input name="due_date" type="date" /></label>
          <button type="submit">Add milestone</button>
        </form>
      )}

      <h3>Tasks</h3>
      {can(membership!.role, 'task:write') && <p><Link to={`/tasks?project=${id}`}>View in task list</Link> · <Link to={`/tasks?project=${id}&client=${p.client_id ?? ''}&new=1`}>New task for this project</Link></p>}
      {tasks.length === 0 ? <p>No tasks linked to this project yet.</p> : (
        <ul className="plain">{tasks.map((t) => (
          <li key={t.id}>{t.title} — {t.status}{t.due_date && t.due_date < today && !['completed', 'cancelled'].includes(t.status) && <small className="overdue"> overdue</small>}</li>
        ))}</ul>
      )}
    </div>
  );
}
