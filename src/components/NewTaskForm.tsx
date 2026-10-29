import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { BellRing, ChevronDown, ListTree, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { dateToTs, label, loadPeople, rpc, type Person } from '../lib/ui';

interface Sub { title: string; department_id: string; assignee_id: string; due: string }
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const FREQS: [string, string][] = [['once', 'Once'], ['daily', 'Daily'], ['weekdays', 'Weekdays (Mon–Fri)'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly (every 3 months)'], ['yearly', 'Yearly'], ['custom', 'Custom']];
const nyToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const ord = (n: number) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
/** Plain-English reminder schedule; the day comes from the start date, as in tt_generate_task_reminders. */
function schedule(freq: string, start: string, every: number) {
  const d = new Date(`${start}T12:00:00`);
  const md = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  return ({
    once: `Once on ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}`,
    daily: 'Every day', weekdays: 'Every weekday (Mon–Fri)',
    weekly: `Every ${d.toLocaleDateString('en-US', { weekday: 'long' })}`,
    monthly: `Every month on the ${ord(d.getDate())}`,
    quarterly: `Every 3 months on the ${ord(d.getDate())}`,
    yearly: `Every year on ${md}`,
    custom: every === 1 ? 'Every day' : `Every ${every} days`,
  } as Record<string, string>)[freq];
}
const fmt12 = (t: string) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const blank = (): Sub => ({ title: '', department_id: '', assignee_id: '', due: '' });

/** Create-task form: organization → department → person, CC emails, due date, sub-tasks (or a template), reminder. */
export default function NewTaskForm({ onDone, onCancel, defaults }: { onDone: (orgId: string) => void; onCancel: () => void; defaults?: { client?: string; project?: string } }) {
  const { membership, memberships, session } = useAuth();
  const uid = session!.user.id;
  const writable = memberships.filter((m) => can(m.role, 'task:write'));
  const [orgId, setOrgId] = useState(membership!.org_id);
  const [people, setPeople] = useState<Person[]>([]);
  const [depts, setDepts] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [tm, setTm] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [dept, setDept] = useState(''), [assignee, setAssignee] = useState('');
  const [title, setTitle] = useState(''), [desc, setDesc] = useState(''), [priority, setPriority] = useState('');
  const [client, setClient] = useState(defaults?.client ?? '');
  const [subs, setSubs] = useState<Sub[]>([]);
  const [remind, setRemind] = useState(true), [freq, setFreq] = useState('daily'), [time, setTime] = useState('09:00');
  const [rStart, setRStart] = useState(nyToday), [every, setEvery] = useState(2);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);

  // everything below depends on the organization chosen at the top
  useEffect(() => {
    setDept(''); setAssignee(''); setSubs([]);
    (async () => {
      const [p, d, t, m, c, pr, tp] = await Promise.all([
        loadPeople(orgId),
        supabase.from('tt_departments').select('id, name').eq('org_id', orgId).order('name'),
        supabase.from('tt_teams').select('id, department_id, manager_id').eq('org_id', orgId),
        supabase.from('tt_team_members').select('team_id, user_id'),
        supabase.from('tt_clients').select('id, name').eq('org_id', orgId).neq('status', 'archived').order('name'),
        supabase.from('tt_projects').select('id, name, client_id').eq('org_id', orgId).neq('status', 'archived').order('name'),
        supabase.from('tt_task_templates').select('*').eq('org_id', orgId).order('name'),
      ]);
      setPeople(p.filter((x) => x.active)); setDepts(d.data ?? []); setTeams(t.data ?? []); setTm(m.data ?? []);
      setClients(c.data ?? []); setProjects(pr.data ?? []); setTemplates(tp.data ?? []);
    })();
  }, [orgId]);

  // people in a department = members of that department's teams; fall back to everyone when it has none
  const inDept = (d: string) => {
    if (!d) return people;
    const teamIds = new Set(teams.filter((t) => t.department_id === d).map((t) => t.id));
    const ids = new Set(tm.filter((m) => teamIds.has(m.team_id)).map((m) => m.user_id));
    const list = people.filter((p) => ids.has(p.id));
    return list.length ? list : people;
  };
  const leads = useMemo(() => {
    if (!assignee) return [];
    const mine = new Set(tm.filter((m) => m.user_id === assignee).map((m) => m.team_id));
    return [...new Set(teams.filter((t) => mine.has(t.id) && t.manager_id && t.manager_id !== assignee).map((t) => t.manager_id))]
      .map((id) => people.find((p) => p.id === id)?.name).filter(Boolean);
  }, [assignee, tm, teams, people]);

  function applyTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    if (!title) setTitle(t.title);
    if (!desc && t.description) setDesc(t.description);
    if (!priority) setPriority(t.priority);
    if (!dept && t.department_ids?.[0]) setDept(t.department_ids[0]);
    if (!assignee && t.assignee_id) setAssignee(t.assignee_id);
    const base = new Date();
    setSubs((s) => [...s, ...(t.subtasks ?? []).map((x: any) => ({
      title: x.title, department_id: t.department_ids?.[0] ?? '', assignee_id: x.assignee_id ?? '',
      due: x.due_offset_days == null ? '' : new Date(base.getTime() + x.due_offset_days * 864e5).toISOString().slice(0, 10),
    }))]);
  }
  const setSub = (i: number, patch: Partial<Sub>) => setSubs((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const cc = String(f.get('cc') ?? '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    const bad = cc.find((x) => !EMAIL.test(x));
    if (bad) return setError(`“${bad}” isn’t a valid email address.`);
    if (!priority) return setError('Choose a priority.');
    if (subs.some((s) => !s.title.trim())) return setError('Give every sub-task a title, or remove the empty ones.');
    setBusy(true); setError('');
    try {
      // newer columns are only sent when used, so a plain task still saves before migrations 0010/0012 are run
      const row: Record<string, unknown> = {
        org_id: orgId, created_by: uid, title: title.trim(), description: desc.trim() || null, priority,
        due_date: dateToTs(f.get('due_date')), start_date: dateToTs(f.get('start_date')),
        client_id: client || null, project_id: f.get('project_id') || null,
        estimated_hours: f.get('estimated_hours') ? Number(f.get('estimated_hours')) : null,
        tags: String(f.get('tags') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
        client_visible: f.get('client_visible') === 'on',
        ...(dept ? { department_id: dept } : {}),
        ...(cc.length ? { notify_emails: cc } : {}),
        ...(remind ? { reminder_enabled: true, reminder_frequency: freq, reminder_time: time, reminder_start: rStart, reminder_interval_days: freq === 'custom' ? every : null } : {}),
      };
      const { data, error: err } = await supabase.from('tt_tasks').insert(row).select('id').single();
      if (err) throw new Error(/column|schema cache/i.test(err.message) ? 'Departments, CC emails and reminders need the database updates (migrations 0010, 0012 and 0013). Turn those off or run the updates.' : err.message);
      if (assignee) await rpc('tt_assign', { p_task: data.id, p_user: assignee, p_add: true });
      for (const s of subs) {
        const { data: sd, error: se } = await supabase.from('tt_tasks').insert({
          org_id: orgId, created_by: uid, parent_task_id: data.id, title: s.title.trim(), priority,
          client_id: client || null, due_date: dateToTs(s.due || null), ...(s.department_id ? { department_id: s.department_id } : {}),
        }).select('id').single();
        if (se) throw new Error(se.message);
        const who = s.assignee_id || assignee;
        if (who) await rpc('tt_assign', { p_task: sd.id, p_user: who, p_add: true });
      }
      const rf = String(f.get('freq') ?? '');
      if (rf) await rpc('tt_set_recurrence', { p_task: data.id, p_freq: rf, p_n: Number(f.get('every') || 1), p_until: f.get('until') || null });
      await supabase.from('tt_activity_logs').insert({ org_id: orgId, actor_id: uid, entity_type: 'task', entity_id: data.id, action: 'created', detail: { subtasks: subs.length } });
      onDone(orgId);
    } catch (x) { setError((x as Error).message); setBusy(false); }
  }

  const deptPeople = inDept(dept);
  return (
    <form className="nt" onSubmit={submit}>
      {writable.length > 1 && (
        <label>Organization<select value={orgId} onChange={(e) => setOrgId(e.target.value)}>{writable.map((m) => <option key={m.org_id} value={m.org_id}>{m.org_name}</option>)}</select></label>
      )}
      <div className="nt-row">
        <label>Department<select value={dept} onChange={(e) => { setDept(e.target.value); setAssignee(''); }}><option value="">Select department</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>Assign user<select value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">Select user</option>{deptPeople.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      </div>
      <label>Task title<input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} placeholder="What needs to be done" /></label>
      <label>Task description<textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={4} placeholder="Enter task details…" /></label>
      <div className="nt-row">
        <label>Priority<select value={priority} onChange={(e) => setPriority(e.target.value)} required><option value="">Select priority</option>{PRIORITIES.map((p) => <option key={p} value={p}>{label(p)}</option>)}</select></label>
        <label><span>Due date <small className="muted">(optional)</small></span><input type="date" name="due_date" /><small className="muted nt-help">The day the task must be finished. Leave empty for no deadline.</small></label>
      </div>
      <div className="nt-row">
        <label><span>Client <small className="muted">(optional)</small></span><select value={client} onChange={(e) => setClient(e.target.value)}><option value="">Select client</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label><span>Project <small className="muted">(optional)</small></span><select key={client} name="project_id" defaultValue={defaults?.project ?? ''}><option value="">{client ? 'Select project' : 'Select project (any client)'}</option>{projects.filter((p) => !client || p.client_id === client).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      </div>
      <label><span>CC emails <small className="muted">(optional)</small></span><input name="cc" placeholder="someone@company.com, other@company.com" />
        <small className="muted nt-help">Separate with commas. The assignee’s team lead is CC’d automatically{leads.length ? `: ${leads.join(', ')}` : ''}.</small></label>

      <fieldset className="nt-subs">
        <div className="nt-subs-head">
          <div><b><ListTree size={16} aria-hidden="true" /> Sub-tasks</b><small className="muted">Break this task into steps, each owned by a different department. The task completes only when every step does.</small></div>
          <div className="nt-subs-actions">
            {templates.length > 0 && <select aria-label="Start from a template" value="" onChange={(e) => applyTemplate(e.target.value)}><option value="">Start from a template…</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
            <button type="button" className="pill-btn ghost" onClick={() => setSubs([...subs, blank()])}><Plus size={15} aria-hidden="true" />Add sub-task</button>
          </div>
        </div>
        {subs.length === 0 ? <p className="muted">No sub-tasks. This will be created as a single task.</p> : (
          <ol className="nt-sub-list">{subs.map((s, i) => (
            <li key={i}>
              <span className="nt-n">{i + 1}</span>
              <input aria-label={`Sub-task ${i + 1} title`} value={s.title} onChange={(e) => setSub(i, { title: e.target.value })} placeholder="Sub-task title" maxLength={200} />
              <select aria-label={`Sub-task ${i + 1} department`} value={s.department_id} onChange={(e) => setSub(i, { department_id: e.target.value, assignee_id: '' })}><option value="">Department</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
              <select aria-label={`Sub-task ${i + 1} owner`} value={s.assignee_id} onChange={(e) => setSub(i, { assignee_id: e.target.value })}><option value="">Same as task</option>{inDept(s.department_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <input aria-label={`Sub-task ${i + 1} due date`} type="date" value={s.due} onChange={(e) => setSub(i, { due: e.target.value })} />
              <button type="button" className="icon-btn sm danger-text" aria-label={`Remove sub-task ${i + 1}`} onClick={() => setSubs(subs.filter((_, j) => j !== i))}><Trash2 size={14} aria-hidden="true" /></button>
            </li>))}</ol>)}
      </fieldset>

      <div className="nt-remind">
        <label className="inline"><input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} /> <b>Reminder</b></label>
        <small className="muted nt-help">When on, Taskify reminds the assignee on this schedule. Times are US Eastern (America/New_York).</small>
        {remind && (<>
          <div className="nt-row">
            <label>Reminder frequency<select value={freq} onChange={(e) => setFreq(e.target.value)}>{FREQS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label>Reminder time<input type="time" value={time} onChange={(e) => setTime(e.target.value || '09:00')} required /></label>
            <label><span>{freq === 'once' ? 'Remind on' : 'Starting'}</span><input type="date" value={rStart} min={nyToday()} onChange={(e) => setRStart(e.target.value || nyToday())} required /></label>
            {freq === 'custom' && <label>Repeat every (days)<input type="number" min={1} max={365} value={every} onChange={(e) => setEvery(Math.min(365, Math.max(1, Number(e.target.value) || 1)))} required /></label>}
          </div>
          <p className="nt-summary"><BellRing size={15} aria-hidden="true" />{schedule(freq, rStart, every)} at {fmt12(time)} ET{freq !== 'once' && rStart > nyToday() ? `, starting ${new Date(`${rStart}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}.</p>
        </>)}
      </div>

      <details className="nt-more">
        <summary><ChevronDown size={15} aria-hidden="true" />More options</summary>
        <div className="nt-row">
          <label>Start date<input type="date" name="start_date" /></label>
          <label>Estimated hours<input type="number" step="0.25" min="0" name="estimated_hours" /></label>
          <label>Tags<input name="tags" placeholder="Comma separated" /></label>
          <label>Repeat<select name="freq" defaultValue=""><option value="">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="custom">Every N days</option></select></label>
          <label>Repeat every (days for custom)<input type="number" name="every" min={1} max={365} defaultValue={1} /></label>
          <label>Repeat until<input type="date" name="until" /></label>
        </div>
        <label className="inline"><input type="checkbox" name="client_visible" /> Visible to client</label>
      </details>

      {error && <p role="alert" className="form-alert">{error}</p>}
      <div className="nt-actions">
        <button type="submit" disabled={busy}>{busy ? 'Creating…' : subs.length ? `Create task + ${subs.length} sub-task${subs.length > 1 ? 's' : ''}` : 'Create task'}</button>
        <button type="button" className="pill-btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
