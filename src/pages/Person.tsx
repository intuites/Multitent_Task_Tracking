import TabThumb from '../components/TabThumb';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowLeft, Building, Camera, CheckCircle2, ChevronDown, Clock, Gauge, ListChecks, Mail, MapPin, Palette, Pencil, Phone, Plus, ShieldCheck,
  Trash2, UserMinus, X,
} from 'lucide-react';
import { deleteAccount } from '../lib/deleteAccount';
import { deletePhotoFile, photoProblem, uploadPhoto } from '../lib/photo';
import MyLook from '../components/MyLook';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { Badge, Due, fmt, fmtTime, label, loadPeople, NO_ESC, rpc, type Person } from '../lib/ui';
import { ROLE_TEXT } from '../lib/roles';
import { ask } from '../components/Dialog';
import { Avatar } from '../components/Frame';
import { CountUp, LiquidBg } from '../components/Liquid';
import { PageSkeleton } from '../components/Skeleton';
import { loadEmails, MemberEmails, type ExtraEmail } from '../components/MemberEmails';
import { describe, type LogRow } from '../lib/activityText';
import { Toggle } from '../stageshow/kit/controls';
import { Toast } from '../stageshow/kit/parts';
import './person.css';

type Tab = 'overview' | 'tasks' | 'look' | 'activity';
const DONE = ['completed', 'completed_cycle'];
const isDone = (s: string) => DONE.includes(s);
// a very long task name reads as its first 60 characters; the full name is on hover and on the task
const short = (t: string) => (t.length > 60 ? `${t.slice(0, 57).trimEnd()}…` : t);

/** One member's page, for admins: everything about them on Overview, and every change made where it's read. */
export default function PersonPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { membership, session } = useAuth();
  const orgId = membership!.org_id, myRole = membership!.role, uid = session!.user.id;
  const admin = can(myRole, 'members:manage');
  const [person, setPerson] = useState<Person | null | undefined>(undefined);
  const [people, setPeople] = useState<Person[]>([]);
  const [pr, setPr] = useState<any>({});
  const [tasks, setTasks] = useState<any[]>([]);
  const [dm, setDm] = useState<string[]>([]);
  const [creator, setCreator] = useState<string | null>(null);
  const [depts, setDepts] = useState<any[]>([]);
  const [acts, setActs] = useState<LogRow[]>([]);
  const [tab, setTab] = useState<Tab>('overview');
  const [taskFilter, setTaskFilter] = useState<'open' | 'done' | 'overdue' | 'all'>('open');
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string; n: number } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState('');
  const [extras, setExtras] = useState<ExtraEmail[]>([]);
  const [sentTo, setSentTo] = useState(''); // '' = every address, 'primary', or an extra address
  const detailsRef = useRef<HTMLElement>(null);

  const load = useCallback(async () => {
    const ppl = await loadPeople(orgId, true);
    setPeople(ppl);
    setPerson(ppl.find((p) => p.id === id) ?? null);
    // the address column only exists after migration 0035, which is also when anyone can have extra addresses
    const ex = (await loadEmails(orgId, [id!])).get(id!) ?? [];
    setExtras(ex);
    const [p, t, m, d, a, o] = await Promise.all([
      supabase.from('tt_profiles').select('*').eq('user_id', id!).maybeSingle(),
      supabase.from('tt_tasks').select(`id, title, status, priority, due_date, completed_at, created_at, departments:tt_departments(name), tt_task_assignees!inner(user_id${ex.length ? ', email' : ''})`)
        .eq('org_id', orgId).eq('tt_task_assignees.user_id', id!).is('archived_at', null).order('due_date', { nullsFirst: false }).limit(2000),
      supabase.from('tt_department_members').select('department_id').eq('org_id', orgId).eq('user_id', id!),
      supabase.from('tt_departments').select('id, name').eq('org_id', orgId).order('name'),
      supabase.from('tt_activity_logs').select('*').eq('org_id', orgId).eq('actor_id', id!).not('action', 'like', NO_ESC).order('created_at', { ascending: false }).limit(60),
      supabase.from('tt_organizations').select('*').eq('id', orgId).maybeSingle(),
    ]);
    setCreator(o.data?.created_by ?? null);
    setPr(p.data ?? {}); setTasks(t.data ?? []); setDm((m.data ?? []).map((x: any) => x.department_id)); setDepts(d.data ?? []); setActs((a.data ?? []) as LogRow[]);
  }, [orgId, id]);
  useEffect(() => { load(); }, [load]);
  // a confirmation slides up and leaves by itself; errors stay until the next action
  useEffect(() => { if (toast?.kind !== 'ok') return; const t = setTimeout(() => setToast(null), 3600); return () => clearTimeout(t); }, [toast]);

  const stats = useMemo(() => {
    const now = Date.now(), month = now - 30 * 864e5;
    let open = 0, done = 0, overdue = 0, late = 0, last30 = 0, started = 0, pending = 0;
    for (const t of tasks) {
      if (isDone(t.status)) {
        done++;
        if (t.completed_at && Date.parse(t.completed_at) >= month) last30++;
        if (t.due_date && t.completed_at && Date.parse(t.completed_at) > Date.parse(t.due_date)) late++;
      } else {
        open++;
        if (t.status === 'started') started++; else pending++;
        if (t.due_date && Date.parse(t.due_date) < now) overdue++;
      }
    }
    // completions per week, last 8 weeks (oldest first)
    const weeks = Array.from({ length: 8 }, () => 0);
    for (const t of tasks) if (t.completed_at) { const w = Math.floor((now - Date.parse(t.completed_at)) / (7 * 864e5)); if (w >= 0 && w < 8) weeks[7 - w]++; }
    return { assigned: tasks.length, open, done, overdue, started, pending, last30, onTime: done ? Math.round(((done - late) / done) * 100) : null, weeks };
  }, [tasks]);

  if (person === undefined) return <PageSkeleton />;
  if (person === null) return <div className="card">This person isn't in {membership!.org_name}. <Link to="/employees">Back to people</Link></div>;

  const isMe = person.id === uid;
  const canEdit = admin;
  // the organization's creator always stays an active admin (enforced in the database too)
  const isCreator = person.id === creator;
  const lockedAccess = isMe || isCreator;
  const myDepts = depts.filter((d) => dm.includes(d.id));
  const ok = (text: string) => { setToast({ kind: 'ok', text, n: Date.now() }); load(); };
  const fail = (text: string) => setToast({ kind: 'error', text, n: Date.now() });
  const log = (action: string, detail: object) => supabase.from('tt_activity_logs').insert({ org_id: orgId, actor_id: uid, entity_type: 'member', entity_id: person.id, action, detail });
  const first = person.name.split(' ')[0];

  // an admin adds, changes or removes this person's photo (file: null removes it). The database decides who may (migration 0049).
  const setPhoto = async (file: File | null) => {
    if (file) { const bad = photoProblem(file); if (bad) return fail(bad); }
    else if (!(await ask({ title: `Remove ${person.name}'s photo?`, message: 'Their initials show instead, everywhere in Taskify.', confirmLabel: 'Remove photo', danger: true })).ok) return;
    setPhotoBusy(true);
    try {
      const old = (pr.avatar_url as string | null) ?? null;
      const url = file ? await uploadPhoto(person.id, file) : null;
      try { await rpc('tt_admin_set_photo', { p_org: orgId, p_user: person.id, p_url: url }); } catch (x) { await deletePhotoFile(url); throw x; }
      await deletePhotoFile(old);
      ok(file ? 'Photo updated everywhere in Taskify.' : 'Photo removed. Their initials show instead.');
    } catch (x) {
      const m = (x as Error).message;
      fail(/row-level security|tt_admin_set_photo|schema cache/i.test(m)
        ? "This photo can't be saved. Either the database update (migration 0049) hasn't been run yet, or this person also belongs to another organization, so only they or a platform admin can change it." : m);
    } finally { setPhotoBusy(false); }
  };

  const saveDetails = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget), g = (k: string) => String(f.get(k) ?? '');
    setBusy('details');
    try {
      await rpc('tt_admin_update_profile', { p_org: orgId, p_user: person.id, p_full_name: g('full_name'), p_job_title: g('job_title'), p_department: g('department'), p_phone: g('phone'), p_location: g('location') });
      setEditing(false); ok('Details saved.');
    } catch (x) { fail(/function/i.test((x as Error).message) ? 'Editing other people needs database update 0016.' : (x as Error).message); }
    setBusy('');
  };
  const setRole = async (r: string) => {
    if (r === person.role) return;
    setBusy('role');
    const { error } = await supabase.from('tt_org_members').update({ role: r }).eq('org_id', orgId).eq('user_id', person.id);
    setBusy('');
    if (error) return fail(error.message);
    await log('role_changed', { user: person.id, to: r }); ok(`${person.name} is now ${label(r)}.`);
  };
  const setActive = async (on: boolean) => {
    if (!on && !(await ask({ title: `Deactivate ${person.name}?`, message: 'They lose access immediately. Their tasks stay in place.', confirmLabel: 'Deactivate', danger: true })).ok) return;
    setBusy('active');
    const { error } = await supabase.from('tt_org_members').update({ active: on }).eq('org_id', orgId).eq('user_id', person.id);
    setBusy('');
    if (error) return fail(error.message);
    await log(on ? 'member_activated' : 'member_deactivated', { user: person.id }); ok(on ? 'Access restored.' : 'Access removed.');
  };
  const joinDept = async (deptId: string) => {
    const { error } = await supabase.from('tt_department_members').insert({ department_id: deptId, user_id: person.id, org_id: orgId });
    if (error) fail(error.message); else ok(`Added to ${depts.find((d) => d.id === deptId)?.name ?? 'the department'}.`);
  };
  const leaveDept = async (d: any) => {
    if (!(await ask({ title: `Remove from ${d.name}?`, message: `${person.name}'s tasks stay assigned.`, confirmLabel: 'Remove', danger: true })).ok) return;
    const { error } = await supabase.from('tt_department_members').delete().eq('department_id', d.id).eq('user_id', person.id);
    if (error) fail(error.message); else ok(`Removed from ${d.name}.`);
  };
  const removeFromOrg = async () => {
    if (!(await ask({ title: `Remove ${person.name} from ${membership!.org_name}?`, message: 'They lose access right away and leave every department. Their tasks, comments and history stay. You can invite them again later.', confirmLabel: 'Remove person', danger: true })).ok) return;
    await supabase.from('tt_department_members').delete().eq('org_id', orgId).eq('user_id', person.id);
    const { error } = await supabase.from('tt_org_members').delete().eq('org_id', orgId).eq('user_id', person.id);
    if (error) return fail(error.message);
    await log('member_removed', { user: person.id });
    navigate('/employees', { replace: true });
  };
  const editDetails = () => { setTab('overview'); setEditing(true); setTimeout(() => detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); };

  const TABS: { id: Tab; name: string; icon: typeof Gauge; n?: number }[] = [
    { id: 'overview', name: 'Overview', icon: Gauge },
    { id: 'tasks', name: 'Tasks', icon: ListChecks, n: stats.open },
    { id: 'activity', name: 'Activity', icon: Activity },
    // platform admins can set anyone's appearance (database: tt_platform_set_look); your own is in Profile
    ...(membership!.platform && !isMe ? [{ id: 'look' as Tab, name: 'Appearance', icon: Palette }] : []),
  ];
  const now = Date.now();
  const addrOf = (t: any): string => t.tt_task_assignees?.[0]?.email ?? 'primary';
  const byStatus = tasks.filter((t) => taskFilter === 'all' ? true : taskFilter === 'done' ? isDone(t.status)
    : taskFilter === 'overdue' ? !isDone(t.status) && t.due_date && Date.parse(t.due_date) < now : !isDone(t.status));
  const addrs = extras.length ? [{ key: 'primary', text: person.email, sub: 'Primary' }, ...extras.map((e) => ({ key: e.email, text: e.email, sub: e.label ?? 'Extra' }))] : [];
  const shownTasks = sentTo ? byStatus.filter((t) => addrOf(t) === sentTo) : byStatus;
  const maxW = Math.max(1, ...stats.weeks);
  const pct = stats.assigned ? Math.round((stats.done / stats.assigned) * 100) : 0;
  const nameOf = (pid?: string | null) => (pid === person.id ? person.name : people.find((p) => p.id === pid)?.name ?? 'someone');
  const titleOf = (tid: string) => tasks.find((t) => t.id === tid)?.title;
  const DETAILS: [string, string, string, typeof Mail][] = [
    ['full_name', 'Full name', pr.full_name ?? '', Building], ['job_title', 'Job title', pr.job_title ?? '', Building],
    ['department', 'Department', pr.department ?? '', Building], ['phone', 'Phone', pr.phone ?? '', Phone], ['location', 'Location', pr.location ?? '', MapPin],
  ];

  return (
    <div className="person ps2">
      <Link to="/employees" className="back-link"><ArrowLeft size={16} aria-hidden="true" />All people</Link>

      <header className="card pf-hero ps-hero">
        <LiquidBg tone="deep" />
        <div className="pf-id">
          {canEdit && !isMe ? (
            <div className={`pf-photo${photoBusy ? ' busy' : ''}`}>
              <Avatar name={person.name} url={pr.avatar_url} className="pf-avatar" />
              <label className="pf-cam" title={pr.avatar_url ? 'Change photo' : 'Add photo'}>
                <Camera size={16} aria-hidden="true" /><span className="sr-only">{pr.avatar_url ? `Change ${person.name}'s photo` : `Add a photo for ${person.name}`}</span>
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={photoBusy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setPhoto(f); }} />
              </label>
              {pr.avatar_url && <button type="button" className="pf-cam rm" title="Remove photo" disabled={photoBusy} onClick={() => setPhoto(null)}><Trash2 size={15} aria-hidden="true" /><span className="sr-only">Remove {person.name}'s photo</span></button>}
            </div>
          ) : <Avatar name={person.name} url={pr.avatar_url} className="pf-avatar" />}
          <div className="pf-name">
            <h2>{person.name}{isMe && <small className="ps-you"> (you)</small>}</h2>
            <p>{pr.job_title || ROLE_TEXT[person.role as keyof typeof ROLE_TEXT]?.blurb || label(person.role)}</p>
            <div className="pf-chips">
              <span className="pf-chip strong">{label(person.role)}</span>
              <span className="pf-chip"><span className={`ps-dot ${person.active ? 'on' : ''}`} />{person.active ? 'Active' : 'Inactive'}</span>
              {myDepts.map((d) => <span key={d.id} className="pf-chip"><Building size={13} aria-hidden="true" />{d.name}</span>)}
            </div>
            <div className="ps-actions">
              {person.email && <a className="pill-btn light sm" href={`mailto:${person.email}`}><Mail size={14} aria-hidden="true" />Email {first}</a>}
              {canEdit && <button type="button" className="pill-btn g-ghost sm" onClick={editDetails}><Pencil size={14} aria-hidden="true" />Edit details</button>}
            </div>
          </div>
        </div>
        <div className="ps-ring" role="img" aria-label={`${pct}% of assigned tasks completed`} style={{ '--p': pct } as React.CSSProperties}>
          <b><CountUp value={pct} />%</b><small>completed</small>
        </div>
      </header>

      <div className="pf-stats ps-stats">
        {([['Assigned', stats.assigned, ListChecks], ['Open', stats.open, Clock], ['Completed', stats.done, CheckCircle2], ['Overdue', stats.overdue, Clock]] as const).map(([k, v, Icon], i) => (
          <div key={k} className={`pf-stat ${k === 'Overdue' && v ? 'bad' : ''}`} style={{ '--i': i } as React.CSSProperties}>
            <span className="rp-ico"><Icon size={18} aria-hidden="true" /></span><small>{k}</small><b><CountUp value={v} /></b>
          </div>))}
      </div>

      <div className="rp-tabs" role="tablist" aria-label="Profile sections">
        <TabThumb />
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            <t.icon size={15} aria-hidden="true" />{t.name}{t.n !== undefined && <span className="tab-n">{t.n}</span>}
          </button>))}
      </div>

      <div key={tab} className="pf-panel">
        {tab === 'overview' && (
          <div className="ps-grid">
            <div className="pf-col">
              {/* details: read here, edited here */}
              <section ref={detailsRef} className="card ps-card" aria-labelledby="dt-h">
                <div className="panel-head"><h3 id="dt-h">Details</h3>
                  {canEdit && !editing && <button type="button" className="pill-btn ghost sm" onClick={() => setEditing(true)}><Pencil size={14} aria-hidden="true" />Edit</button>}</div>
                {editing ? (
                  <form className="ps-edit" onSubmit={saveDetails} key={pr.updated_at ?? 'x'}>
                    <label>Full name<input name="full_name" defaultValue={pr.full_name ?? ''} maxLength={120} autoFocus /></label>
                    <label>Job title<input name="job_title" defaultValue={pr.job_title ?? ''} maxLength={120} /></label>
                    <label>Department<select name="department" defaultValue={pr.department ?? ''}><option value="">None</option>
                      {[...new Set([...depts.map((d) => d.name), ...(pr.department ? [pr.department] : [])])].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
                    <label>Phone<input name="phone" type="tel" defaultValue={pr.phone ?? ''} maxLength={40} /></label>
                    <label>Location<input name="location" defaultValue={pr.location ?? ''} maxLength={120} /></label>
                    <label>Email<input value={person.email} disabled readOnly /><small className="muted">People change their sign-in email from their own profile.</small></label>
                    <span className="ps-edit-actions">
                      <button type="submit" disabled={busy === 'details'}><CheckCircle2 size={15} aria-hidden="true" />{busy === 'details' ? 'Saving…' : 'Save details'}</button>
                      <button type="button" className="pill-btn ghost" onClick={() => setEditing(false)}>Cancel</button>
                    </span>
                  </form>
                ) : (
                  <dl className="ps-read">
                    {DETAILS.map(([k, l, v]) => <div key={k}><dt>{l}</dt><dd>{v || <span className="muted">Not set</span>}</dd></div>)}
                    <div><dt>Email</dt><dd><a href={`mailto:${person.email}`}>{person.email}</a></dd></div>
                    {pr.bio && <div><dt>About</dt><dd className="ps-bio">{pr.bio}</dd></div>}
                  </dl>
                )}
              </section>

              <section className="card ps-card" aria-labelledby="em-h">
                <h3 id="em-h">Email addresses</h3>
                <p className="muted ps-note">When you create a task for {isMe ? 'yourself' : first}, you can pick which address gets its emails.</p>
                <MemberEmails orgId={orgId} userId={person.id} primary={person.email} canEdit={admin || isMe} onChange={load} />
              </section>

              <section className="card ps-card" aria-labelledby="ov-perf">
                <h3 id="ov-perf">Performance</h3>
                <ul className="ps-kv">
                  <li><small>On time</small><b>{stats.onTime === null ? '—' : `${stats.onTime}%`}</b></li>
                  <li><small>Done in 30 days</small><b>{stats.last30}</b></li>
                  <li><small>Started</small><b>{stats.started}</b></li>
                  <li><small>Not started or pending</small><b>{stats.pending}</b></li>
                </ul>
                <h4 className="ps-sub">Completed per week</h4>
                <div className="ps-weeks" role="img" aria-label={`Completed per week, oldest first: ${stats.weeks.join(', ')}`}>
                  {stats.weeks.map((w, i) => <span key={i} style={{ '--i': i } as React.CSSProperties}><i style={{ height: `${w ? Math.max(10, (w / maxW) * 100) : 4}%` }} className={w ? '' : 'zero'} /><small>{i === 7 ? 'This wk' : `${7 - i}w`}</small></span>)}
                </div>
              </section>
            </div>

            <div className="pf-col">
              {admin && (
                <section className="card ps-card" aria-labelledby="ac-h">
                  <h3 id="ac-h"><ShieldCheck size={16} aria-hidden="true" />Access</h3>
                  <div className="ps-field">
                    <span className="ps-label">Role</span>
                    <div className="seg ps-role" role="group" aria-label="Role" aria-disabled={lockedAccess || undefined}>
                      <TabThumb />
                      {['employee', 'admin'].map((r) => (
                        <button key={r} type="button" aria-pressed={person.role === r} disabled={lockedAccess || busy === 'role'} onClick={() => setRole(r)}>{label(r)}</button>
                      ))}
                    </div>
                    <small className="muted">{ROLE_TEXT[person.role as keyof typeof ROLE_TEXT]?.blurb}</small>
                  </div>
                  <div className="ps-field ps-switch-row">
                    <span><span className="ps-label">Can sign in</span><small className="muted">{person.active ? 'Has access to this organization.' : 'Access is off. Tasks stay assigned.'}</small></span>
                    <button type="button" role="switch" aria-checked={person.active} aria-label={person.active ? `Deactivate ${person.name}` : `Activate ${person.name}`}
                      className="ps-switch" disabled={lockedAccess || busy === 'active'} onClick={() => setActive(!person.active)}><Toggle on={person.active} aria-hidden="true" /></button>
                  </div>
                  {lockedAccess && <p className="muted ps-note">{isCreator ? `${isMe ? 'You' : person.name} created this organization, so ${isMe ? 'you stay' : 'they stay'} an active admin.` : "You can't change your own role or access."}</p>}
                  <div className="ps-field">
                    <span className="ps-label">Departments</span>
                    <ul className="ps-chips">
                      {myDepts.map((d) => <li key={d.id}>{d.name}<button type="button" aria-label={`Remove from ${d.name}`} onClick={() => leaveDept(d)}><X size={13} aria-hidden="true" /></button></li>)}
                      {depts.length > myDepts.length && (
                        <li className="ps-add"><Plus size={13} aria-hidden="true" />
                          <select aria-label="Add to a department" value="" onChange={(e) => e.target.value && joinDept(e.target.value)}>
                            <option value="">Add to a department</option>{depts.filter((d) => !dm.includes(d.id)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select></li>)}
                    </ul>
                    {myDepts.length === 0 && <small className="muted">Not in any department yet.</small>}
                  </div>
                </section>
              )}

              <section className="card ps-card" aria-labelledby="ov-next">
                <div className="panel-head"><h3 id="ov-next">Up next</h3><button type="button" className="mini-link" onClick={() => setTab('tasks')}>All tasks</button></div>
                {tasks.filter((t) => !isDone(t.status)).length === 0 ? <p className="muted">Nothing open right now.</p> : (
                  <ul className="pf-tasks">{tasks.filter((t) => !isDone(t.status)).slice(0, 5).map((t) => (
                    <li key={t.id}><Link to={`/tasks/${t.id}`}><b>{t.title}</b><span className="ps-meta"><Badge v={t.status} /><Due t={t} /></span></Link></li>))}</ul>)}
              </section>

              {!isMe && canEdit && (!isCreator || membership!.platform) && (
                <details className="card ps-card ps-danger">
                  <summary><AlertTriangle size={16} aria-hidden="true" /><span>Danger zone</span><ChevronDown size={16} className="ps-chev" aria-hidden="true" /></summary>
                  {!isCreator && (
                    <div className="ps-danger-row">
                      <span><b>Remove from {membership!.org_name}</b><small className="muted">They lose access right away. Their tasks, comments and history stay.</small></span>
                      <button type="button" className="pill-btn ghost sm danger-text" onClick={removeFromOrg}><UserMinus size={14} aria-hidden="true" />Remove</button>
                    </div>)}
                  {(membership!.platform || person.role === 'employee') && (
                    <div className="ps-danger-row">
                      <span><b>Delete account</b><small className="muted">Deletes {first}'s login, with their comments, assignments and history. Tasks and files they created stay.
                        {!membership!.platform && ' Only for employees who belong to this organization alone.'}</small></span>
                      <button type="button" className="pill-btn ghost sm danger-text" onClick={async () => {
                        try { if (await deleteAccount({ id: person.id, name: person.name, email: person.email })) navigate('/employees', { replace: true }); }
                        catch (x) { fail((x as Error).message); }
                      }}><Trash2 size={14} aria-hidden="true" />Delete</button>
                    </div>)}
                </details>
              )}
            </div>
          </div>
        )}

        {tab === 'tasks' && (
          <section className="card" aria-label="Tasks">
            <div className="seg ps-seg" role="group" aria-label="Filter tasks">
              {(['open', 'overdue', 'done', 'all'] as const).map((f) => <button key={f} type="button" aria-pressed={taskFilter === f} onClick={() => setTaskFilter(f)}>{f === 'done' ? 'Completed' : label(f)}</button>)}
            </div>
            {addrs.length > 0 && (
              <div className="me-chips" role="group" aria-label="Filter by the address tasks are sent to">
                <button type="button" aria-pressed={sentTo === ''} onClick={() => setSentTo('')}><span><b>Every address</b></span><span className="tab-n">{byStatus.length}</span></button>
                {addrs.map((a) => (
                  <button key={a.key} type="button" aria-pressed={sentTo === a.key} onClick={() => setSentTo(a.key)}>
                    <Mail size={14} aria-hidden="true" /><span><b>{a.text}</b><small>{a.sub}</small></span><span className="tab-n">{byStatus.filter((t) => addrOf(t) === a.key).length}</span>
                  </button>))}
              </div>)}
            {shownTasks.length === 0 ? <p className="muted">No tasks here.</p> : (
              <table className="emp-table"><thead><tr><th>Task</th><th>Status</th><th>Priority</th><th>Department</th>{addrs.length > 0 && <th>Sent to</th>}<th>Due</th></tr></thead>
                <tbody>{shownTasks.map((t) => (
                  <tr key={t.id}><td><Link to={`/tasks/${t.id}`}>{t.title}</Link></td><td><Badge v={t.status} /></td><td>{label(t.priority)}</td><td>{t.departments?.name ?? '—'}</td>
                    {addrs.length > 0 && <td className="me-to">{addrOf(t) === 'primary' ? person.email : addrOf(t)}</td>}<td><Due t={t} /></td></tr>))}</tbody></table>)}
          </section>
        )}

        {tab === 'look' && membership!.platform && !isMe && (
          <MyLook person={{ id: person.id, name: person.name, prefs: pr.prefs ?? {} }} onSaved={load} />
        )}

        {tab === 'activity' && (
          <section className="card" aria-labelledby="act-h">
            <h3 id="act-h">Recent activity</h3>
            {acts.length === 0 ? <p className="muted">No activity recorded yet.</p> : (
              <ul className="timeline">{acts.map((a) => {
                const s = describe(a, nameOf, titleOf);
                return (
                  <li key={a.id}><span className="tl-dot" aria-hidden="true" /><span>{first} {s.verb}{s.target && <> {s.target.to ? <Link to={s.target.to} title={s.target.text}>{short(s.target.text)}</Link> : short(s.target.text)}</>}{s.rest}
                    <small className="muted"> · {fmtTime(a.created_at)}</small></span></li>);
              })}</ul>)}
          </section>
        )}
      </div>
      <p className="muted ps-foot">Member of {membership!.org_name}{pr.created_at ? ` since ${fmt(pr.created_at)}` : ''}.</p>

      {/* confirmations slide up from the foot of the window and leave by themselves (stageshow Toast) */}
      <Toast show={!!toast} className={`ps-toast ${toast?.kind ?? ''}`} icon={toast?.kind === 'error' ? <X size={15} /> : <CheckCircle2 size={15} />}
        action={toast?.kind === 'error' ? <button type="button" className="ps-toast-x" aria-label="Dismiss" onClick={() => setToast(null)}><X size={14} aria-hidden="true" /></button> : undefined}
        data-n={toast?.n}>{toast?.text ?? ''}</Toast>
    </div>
  );
}
