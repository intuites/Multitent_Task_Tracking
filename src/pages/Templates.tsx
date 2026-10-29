import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CopyPlus, GripVertical, ListTree, Mail, Pencil, Play, Plus, Trash2, UserRound, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { label, rpc, usePeople } from '../lib/ui';
import { ask } from '../components/Dialog';
import { ListSkeleton } from '../components/Skeleton';

interface Sub { title: string; assignee_id: string | null; start_offset_days: number; due_offset_days: number | null }
interface Tpl {
  id?: string; name: string; title: string; description: string | null; priority: string; department_ids: string[];
  assignee_id: string | null; notify_emails: string[]; subtasks: Sub[]; due_offset_days: number | null;
}
const EMPTY: Tpl = { name: '', title: '', description: '', priority: 'medium', department_ids: [], assignee_id: null, notify_emails: [], subtasks: [], due_offset_days: 7 };
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const emails = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

export default function Templates() {
  const { membership } = useAuth();
  const orgId = membership!.org_id;
  const navigate = useNavigate();
  const { active, name } = usePeople(orgId);
  const [list, setList] = useState<Tpl[] | null>(null);
  const [depts, setDepts] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [edit, setEdit] = useState<Tpl | null>(null);
  const [use, setUse] = useState<Tpl | null>(null);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    const [t, d, c, p] = await Promise.all([
      supabase.from('tt_task_templates').select('*').eq('org_id', orgId).order('name'),
      supabase.from('tt_departments').select('id, name').eq('org_id', orgId).order('name'),
      supabase.from('tt_clients').select('id, name').eq('org_id', orgId).neq('status', 'archived').order('name'),
      supabase.from('tt_projects').select('id, name').eq('org_id', orgId).neq('status', 'archived').order('name'),
    ]);
    // the table arrives with migration 0010; explain instead of showing a raw error
    if (t.error) setMissing(/relation|schema cache|does not exist/i.test(t.error.message)); else setMissing(false);
    setList((t.data ?? []) as Tpl[]); setDepts(d.data ?? []); setClients(c.data ?? []); setProjects(p.data ?? []);
  }, [orgId]);
  useEffect(() => { load(); }, [load]);
  const deptName = (id: string) => depts.find((d) => d.id === id)?.name ?? 'Department';

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!edit) return;
    // parsed on save so typing commas between addresses isn't fought by the input
    const notify = emails(String(new FormData(e.currentTarget).get('emails') ?? ''));
    const bad = notify.find((x) => !EMAIL.test(x));
    if (bad) return setError(`“${bad}” isn’t a valid email address.`);
    if (edit.subtasks.some((s) => !s.title.trim())) return setError('Give every subtask a title, or remove the empty ones.');
    const row = { ...edit, notify_emails: notify, org_id: orgId, name: edit.name.trim(), title: edit.title.trim(), description: edit.description?.trim() || null, updated_at: new Date().toISOString() };
    delete (row as any).id;
    const res = edit.id ? await supabase.from('tt_task_templates').update(row).eq('id', edit.id) : await supabase.from('tt_task_templates').insert(row);
    if (res.error) return setError(/duplicate|unique/i.test(res.error.message) ? 'A template with that name already exists.' : res.error.message);
    setError(''); setEdit(null); load();
  }
  async function remove(t: Tpl) {
    if (!(await ask({ title: 'Delete template?', message: `“${t.name}” will be deleted. Tasks already created from it are not affected.`, confirmLabel: 'Delete template', danger: true })).ok) return;
    const { error: err } = await supabase.from('tt_task_templates').delete().eq('id', t.id!);
    if (err) setError(err.message); else load();
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!use) return;
    const f = new FormData(e.currentTarget);
    const extra = emails(String(f.get('emails') ?? ''));
    const bad = extra.find((x) => !EMAIL.test(x));
    if (bad) return setError(`“${bad}” isn’t a valid email address.`);
    try {
      const id = await rpc<string>('tt_create_from_template', {
        p_template: use.id, p_title: String(f.get('title') || ''), p_department: f.get('department') || null, p_assignee: f.get('assignee') || null,
        p_client: f.get('client') || null, p_project: f.get('project') || null, p_start: f.get('start') || null, p_extra_emails: extra,
      });
      navigate(`/tasks/${id}`);
    } catch (x) { setError((x as Error).message); }
  }

  const setSub = (i: number, patch: Partial<Sub>) => setEdit((t) => t && { ...t, subtasks: t.subtasks.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  return (
    <>
      <div className="page-head">
        <div><h2 className="page-title">Task templates</h2><p className="page-sub">Set up repeat work once. Each template creates a task with its subtasks, people and dates filled in.</p></div>
        <div className="page-actions">{!missing && <button type="button" className="pill-btn" onClick={() => { setUse(null); setEdit({ ...EMPTY }); setError(''); }}><Plus size={16} aria-hidden="true" />New template</button>}</div>
      </div>
      {missing && <p className="form-alert">Templates need the database update. Run <b>supabase/migrations/0010_subclients_templates_avatars.sql</b> in the Supabase SQL Editor, then refresh.</p>}
      {error && <p role="alert" className="form-alert">{error}</p>}

      {edit && (
        <section className="card tpl-edit" aria-labelledby="tpl-h">
          <div className="panel-head"><h3 id="tpl-h">{edit.id ? `Edit “${edit.name}”` : 'New template'}</h3><button type="button" className="icon-btn sm" aria-label="Close" onClick={() => setEdit(null)}><X size={16} aria-hidden="true" /></button></div>
          <form className="pf-form" onSubmit={save}>
            <label>Template name<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required maxLength={120} placeholder="Client onboarding" /></label>
            <label>Task title<input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} required maxLength={200} placeholder="Onboard new client" /></label>
            <label>Priority<select value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value })}>{['low', 'medium', 'high', 'urgent'].map((p) => <option key={p} value={p}>{label(p)}</option>)}</select></label>
            <label>Due after (days)<input type="number" min={0} max={3650} value={edit.due_offset_days ?? ''} onChange={(e) => setEdit({ ...edit, due_offset_days: e.target.value === '' ? null : Number(e.target.value) })} /></label>
            <label>Default assignee<select value={edit.assignee_id ?? ''} onChange={(e) => setEdit({ ...edit, assignee_id: e.target.value || null })}><option value="">Choose when using</option>{active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>Notify these emails<input name="emails" key={edit.id ?? 'new'} defaultValue={edit.notify_emails.join(', ')} placeholder="lead@company.com, ops@company.com" /></label>
            <fieldset className="pf-wide tpl-depts"><legend>Departments</legend>
              {depts.length === 0 ? <span className="muted">No departments yet. Add them in Employees &amp; Teams.</span> : depts.map((d) => (
                <label key={d.id} className="inline"><input type="checkbox" checked={edit.department_ids.includes(d.id)}
                  onChange={(e) => setEdit({ ...edit, department_ids: e.target.checked ? [...edit.department_ids, d.id] : edit.department_ids.filter((x) => x !== d.id) })} /> {d.name}</label>))}
            </fieldset>
            <label className="pf-wide">Description<textarea rows={3} value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></label>
            <p className="muted pf-wide tpl-note"><Mail size={14} aria-hidden="true" /> The assignee’s team lead is always notified first. The emails above get a copy once your email provider is connected.</p>

            <div className="pf-wide tpl-subs">
              <div className="panel-head"><h3><ListTree size={16} aria-hidden="true" /> Subtasks</h3><small className="muted">{edit.subtasks.length}</small></div>
              {edit.subtasks.length === 0 && <p className="muted">No subtasks. Add as many steps as this work needs.</p>}
              <ol className="sub-rows">{edit.subtasks.map((s, i) => (
                <li key={i}>
                  <GripVertical size={16} className="muted" aria-hidden="true" />
                  <input aria-label={`Subtask ${i + 1} title`} value={s.title} onChange={(e) => setSub(i, { title: e.target.value })} placeholder={`Subtask ${i + 1}`} maxLength={200} />
                  <select aria-label={`Subtask ${i + 1} assignee`} value={s.assignee_id ?? ''} onChange={(e) => setSub(i, { assignee_id: e.target.value || null })}><option value="">Same as task</option>{active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                  <label className="sub-num">Starts day<input type="number" min={0} max={3650} value={s.start_offset_days} onChange={(e) => setSub(i, { start_offset_days: Number(e.target.value) || 0 })} /></label>
                  <label className="sub-num">Due day<input type="number" min={0} max={3650} value={s.due_offset_days ?? ''} onChange={(e) => setSub(i, { due_offset_days: e.target.value === '' ? null : Number(e.target.value) })} /></label>
                  <button type="button" className="icon-btn sm danger-text" aria-label={`Remove subtask ${i + 1}`} onClick={() => setEdit({ ...edit, subtasks: edit.subtasks.filter((_, j) => j !== i) })}><Trash2 size={14} aria-hidden="true" /></button>
                </li>))}</ol>
              <button type="button" className="pill-btn ghost" onClick={() => setEdit({ ...edit, subtasks: [...edit.subtasks, { title: '', assignee_id: null, start_offset_days: 0, due_offset_days: null }] })}><Plus size={15} aria-hidden="true" />Add subtask</button>
              <p className="muted tpl-note">Days count from the start date you pick when using the template, so a subtask can be scheduled for later.</p>
            </div>
            <div className="pf-wide pf-actions"><button type="submit">{edit.id ? 'Save template' : 'Create template'}</button><button type="button" className="link" onClick={() => setEdit(null)}>Cancel</button></div>
          </form>
        </section>
      )}

      {use && (
        <section className="card tpl-edit" aria-labelledby="use-h">
          <div className="panel-head"><h3 id="use-h">Create task from “{use.name}”</h3><button type="button" className="icon-btn sm" aria-label="Close" onClick={() => setUse(null)}><X size={16} aria-hidden="true" /></button></div>
          <form className="pf-form" onSubmit={create}>
            <label className="pf-wide">Task title<input name="title" defaultValue={use.title} maxLength={200} /></label>
            <label>Department<select name="department" defaultValue={use.department_ids[0] ?? ''}><option value="">None</option>
              {(use.department_ids.length ? depts.filter((d) => use.department_ids.includes(d.id)) : depts).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
            <label>Assignee<select name="assignee" defaultValue={use.assignee_id ?? ''}><option value="">Unassigned</option>{active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>Client<select name="client" defaultValue=""><option value="">None</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Project<select name="project" defaultValue=""><option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>Start date<input type="date" name="start" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
            <label>Also notify<input name="emails" placeholder="extra@company.com" /></label>
            <p className="muted pf-wide tpl-note">Creates 1 task and {use.subtasks.length} subtask{use.subtasks.length === 1 ? '' : 's'}.{use.notify_emails.length > 0 && ` Notifies ${use.notify_emails.join(', ')}.`}</p>
            <div className="pf-wide pf-actions"><button type="submit"><Play size={15} aria-hidden="true" />Create task</button><button type="button" className="link" onClick={() => setUse(null)}>Cancel</button></div>
          </form>
        </section>
      )}

      {list === null ? <div className="card"><ListSkeleton rows={3} /></div> : list.length === 0 && !missing ? (
        <div className="card rp-empty"><CopyPlus size={28} aria-hidden="true" /><p>No templates yet. Create one for work you set up again and again.</p></div>
      ) : (
        <div className="tpl-grid">{list.map((t, i) => (
          <article key={t.id} className="tpl-card" style={{ '--i': i } as React.CSSProperties}>
            <div className="tpl-top"><span className={`prio prio-${t.priority}`}>{label(t.priority)}</span>{t.due_offset_days != null && <small className="muted">Due in {t.due_offset_days} days</small>}</div>
            <h3>{t.name}</h3>
            <p className="muted">{t.title}</p>
            <ul className="tpl-meta">
              <li><ListTree size={14} aria-hidden="true" />{t.subtasks.length} subtask{t.subtasks.length === 1 ? '' : 's'}</li>
              {t.assignee_id && <li><UserRound size={14} aria-hidden="true" />{name(t.assignee_id)}</li>}
              {t.notify_emails.length > 0 && <li><Mail size={14} aria-hidden="true" />{t.notify_emails.length} email{t.notify_emails.length === 1 ? '' : 's'}</li>}
            </ul>
            {t.department_ids.length > 0 && <div className="tag-row">{t.department_ids.map((d) => <span key={d} className="tag">{deptName(d)}</span>)}</div>}
            <div className="tpl-actions">
              <button type="button" onClick={() => { setEdit(null); setUse(t); setError(''); }}><Play size={15} aria-hidden="true" />Use template</button>
              <button type="button" className="icon-btn sm" aria-label={`Edit ${t.name}`} onClick={() => { setUse(null); setEdit({ ...t, description: t.description ?? '' }); setError(''); }}><Pencil size={15} aria-hidden="true" /></button>
              <button type="button" className="icon-btn sm danger-text" aria-label={`Delete ${t.name}`} onClick={() => remove(t)}><Trash2 size={15} aria-hidden="true" /></button>
            </div>
          </article>))}
        </div>
      )}
    </>
  );
}
