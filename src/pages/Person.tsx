import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Activity, ArrowLeft, Briefcase, Building, CheckCircle2, Clock, Gauge, ListChecks, Mail, MapPin, Phone, ShieldCheck, UserMinus, Users, X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { Badge, Due, fmt, fmtTime, label, loadPeople, rpc, type Person } from '../lib/ui';
import { ROLE_TEXT } from '../lib/roles';
import { ask } from '../components/Dialog';
import { Avatar } from '../components/Frame';
import { CountUp, LiquidBg } from '../components/Liquid';
import { PageSkeleton } from '../components/Skeleton';

type Tab = 'overview' | 'tasks' | 'team' | 'details' | 'access' | 'activity';
const DONE = ['completed', 'completed_cycle'];
const isDone = (s: string) => DONE.includes(s);

/** Full profile of one member, for owners/admins (edit everything) and managers (view). */
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
  const [teams, setTeams] = useState<any[]>([]);
  const [tm, setTm] = useState<any[]>([]);
  const [depts, setDepts] = useState<any[]>([]);
  const [acts, setActs] = useState<any[]>([]);
  const [tab, setTab] = useState<Tab>('overview');
  const [taskFilter, setTaskFilter] = useState<'open' | 'done' | 'overdue' | 'all'>('open');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    const ppl = await loadPeople(orgId, true);
    setPeople(ppl); setPerson(ppl.find((p) => p.id === id) ?? null);
    const [p, t, te, m, d, a] = await Promise.all([
      supabase.from('tt_profiles').select('*').eq('user_id', id!).maybeSingle(),
      supabase.from('tt_tasks').select('id, title, status, priority, due_date, completed_at, created_at, projects:tt_projects(name), tt_task_assignees!inner(user_id)')
        .eq('org_id', orgId).eq('tt_task_assignees.user_id', id!).is('archived_at', null).order('due_date', { nullsFirst: false }).limit(2000),
      supabase.from('tt_teams').select('*').eq('org_id', orgId).order('name'),
      supabase.from('tt_team_members').select('*'),
      supabase.from('tt_departments').select('id, name').eq('org_id', orgId).order('name'),
      supabase.from('tt_activity_logs').select('*').eq('org_id', orgId).eq('actor_id', id!).order('created_at', { ascending: false }).limit(60),
    ]);
    setPr(p.data ?? {}); setTasks(t.data ?? []); setTeams(te.data ?? []); setTm(m.data ?? []); setDepts(d.data ?? []); setActs(a.data ?? []);
  }, [orgId, id]);
  useEffect(() => { load(); }, [load]);

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
  const canEdit = admin && (myRole === 'owner' || person.role !== 'owner' || isMe);
  const myTeams = tm.filter((m) => m.user_id === person.id).map((m) => teams.find((t) => t.id === m.team_id)).filter(Boolean) as any[];
  const leads = teams.filter((t) => t.manager_id === person.id);
  const isLead = person.role !== 'employee' || leads.length > 0;
  const name = (pid: string) => people.find((p) => p.id === pid)?.name ?? 'Unknown';
  const ok = (text: string) => { setMsg({ kind: 'ok', text }); load(); };
  const fail = (text: string) => setMsg({ kind: 'error', text });
  const log = (action: string, detail: object) => supabase.from('tt_activity_logs').insert({ org_id: orgId, actor_id: uid, entity_type: 'member', entity_id: person.id, action, detail });

  const saveDetails = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget), g = (k: string) => String(f.get(k) ?? '');
    try {
      await rpc('tt_admin_update_profile', { p_org: orgId, p_user: person.id, p_full_name: g('full_name'), p_job_title: g('job_title'), p_department: g('department'), p_phone: g('phone'), p_location: g('location') });
      ok('Details saved.');
    } catch (x) { fail(/function/i.test((x as Error).message) ? 'Editing other people needs database update 0016.' : (x as Error).message); }
  };
  const setRole = async (r: string) => {
    const { error } = await supabase.from('tt_org_members').update({ role: r }).eq('org_id', orgId).eq('user_id', person.id);
    if (error) return fail(error.message);
    await log('role_changed', { user: person.id, to: r }); ok(`${person.name} is now ${label(r)}.`);
  };
  const setActive = async (on: boolean) => {
    if (!on && !(await ask({ title: `Deactivate ${person.name}?`, message: 'They lose access immediately. Their tasks stay in place.', confirmLabel: 'Deactivate', danger: true })).ok) return;
    const { error } = await supabase.from('tt_org_members').update({ active: on }).eq('org_id', orgId).eq('user_id', person.id);
    if (error) return fail(error.message);
    await log(on ? 'member_activated' : 'member_deactivated', { user: person.id }); ok(on ? 'Access restored.' : 'Access removed.');
  };
  const joinTeam = async (teamId: string) => {
    const { error } = await supabase.from('tt_team_members').insert({ team_id: teamId, user_id: person.id });
    if (error) fail(error.message); else ok('Added to the team.');
  };
  const leaveTeam = async (t: any) => {
    if (!(await ask({ title: `Remove from ${t.name}?`, message: `${person.name}'s tasks stay assigned.`, confirmLabel: 'Remove', danger: true })).ok) return;
    const { error } = await supabase.from('tt_team_members').delete().eq('team_id', t.id).eq('user_id', person.id);
    if (error) fail(error.message); else ok('Removed from the team.');
  };
  const removeFromOrg = async () => {
    if (!(await ask({ title: `Remove ${person.name} from ${membership!.org_name}?`, message: 'They lose access right away and leave every team. Their tasks, comments and history stay. You can invite them again later.', confirmLabel: 'Remove person', danger: true })).ok) return;
    await supabase.from('tt_team_members').delete().eq('user_id', person.id).in('team_id', teams.map((t) => t.id));
    const { error } = await supabase.from('tt_org_members').delete().eq('org_id', orgId).eq('user_id', person.id);
    if (error) return fail(error.message);
    await log('member_removed', { user: person.id });
    navigate('/employees', { replace: true });
  };

  const TABS: { id: Tab; name: string; icon: typeof Gauge; n?: number }[] = [
    { id: 'overview', name: 'Overview', icon: Gauge },
    { id: 'tasks', name: 'Tasks', icon: ListChecks, n: stats.open },
    ...(isLead ? [{ id: 'team' as Tab, name: 'Teams led', icon: Users, n: leads.length }] : []),
    { id: 'details', name: 'Details', icon: Briefcase },
    ...(admin ? [{ id: 'access' as Tab, name: 'Access & teams', icon: ShieldCheck }] : []),
    { id: 'activity', name: 'Activity', icon: Activity },
  ];
  const now = Date.now();
  const shownTasks = tasks.filter((t) => taskFilter === 'all' ? true : taskFilter === 'done' ? isDone(t.status)
    : taskFilter === 'overdue' ? !isDone(t.status) && t.due_date && Date.parse(t.due_date) < now : !isDone(t.status));
  const maxW = Math.max(1, ...stats.weeks);
  const pct = stats.assigned ? Math.round((stats.done / stats.assigned) * 100) : 0;

  return (
    <div className="person">
      <Link to="/employees" className="back-link"><ArrowLeft size={16} aria-hidden="true" />All people</Link>

      <header className="card pf-hero ps-hero">
        <LiquidBg tone="deep" />
        <div className="pf-id">
          <Avatar name={person.name} url={pr.avatar_url} className="pf-avatar" />
          <div className="pf-name">
            <h2>{person.name}{isMe && <small className="ps-you"> (you)</small>}</h2>
            <p>{pr.job_title || ROLE_TEXT[person.role as keyof typeof ROLE_TEXT]?.blurb || label(person.role)}</p>
            <div className="pf-chips">
              <span className="pf-chip strong">{label(person.role)}</span>
              <span className="pf-chip"><span className={`ps-dot ${person.active ? 'on' : ''}`} />{person.active ? 'Active' : 'Inactive'}</span>
              {person.email && <a className="pf-chip" href={`mailto:${person.email}`}><Mail size={13} aria-hidden="true" />{person.email}</a>}
              {pr.phone && <span className="pf-chip"><Phone size={13} aria-hidden="true" />{pr.phone}</span>}
              {pr.location && <span className="pf-chip"><MapPin size={13} aria-hidden="true" />{pr.location}</span>}
              {pr.department && <span className="pf-chip"><Building size={13} aria-hidden="true" />{pr.department}</span>}
            </div>
          </div>
        </div>
        <div className="ps-ring" role="img" aria-label={`${pct}% of assigned tasks completed`} style={{ '--p': pct } as React.CSSProperties}>
          <b><CountUp value={pct} />%</b><small>completed</small>
        </div>
      </header>

      {msg && <p key={msg.text} role={msg.kind === 'error' ? 'alert' : 'status'} className={`auth-msg ${msg.kind}`}>{msg.kind === 'error' ? <X size={17} aria-hidden="true" /> : <CheckCircle2 size={17} aria-hidden="true" />}<span>{msg.text}</span></p>}

      <div className="pf-stats ps-stats">
        {([['Assigned', stats.assigned, ListChecks], ['Open', stats.open, Clock], ['Completed', stats.done, CheckCircle2], ['Overdue', stats.overdue, Clock]] as const).map(([k, v, Icon], i) => (
          <div key={k} className={`pf-stat ${k === 'Overdue' && v ? 'bad' : ''}`} style={{ '--i': i } as React.CSSProperties}>
            <span className="rp-ico"><Icon size={18} aria-hidden="true" /></span><small>{k}</small><b><CountUp value={v} /></b>
          </div>))}
      </div>

      <div className="rp-tabs" role="tablist" aria-label="Profile sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            <t.icon size={15} aria-hidden="true" />{t.name}{t.n !== undefined && <span className="tab-n">{t.n}</span>}
          </button>))}
      </div>

      <div key={tab} className="pf-panel">
        {tab === 'overview' && (
          <div className="pf-grid">
            <section className="card" aria-labelledby="ov-perf">
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
            <div className="pf-col">
              <section className="card" aria-labelledby="ov-next">
                <div className="panel-head"><h3 id="ov-next">Up next</h3><button type="button" className="mini-link" onClick={() => setTab('tasks')}>All tasks</button></div>
                {tasks.filter((t) => !isDone(t.status)).length === 0 ? <p className="muted">Nothing open right now.</p> : (
                  <ul className="pf-tasks">{tasks.filter((t) => !isDone(t.status)).slice(0, 5).map((t) => (
                    <li key={t.id}><Link to={`/tasks/${t.id}`}><b>{t.title}</b><span className="ps-meta"><Badge v={t.status} /><Due t={t} /></span></Link></li>))}</ul>)}
              </section>
              <section className="card" aria-labelledby="ov-teams">
                <h3 id="ov-teams">Teams</h3>
                {myTeams.length === 0 ? <p className="muted">Not in any team.</p> : <ul className="pp-chips">{myTeams.map((t) => <li key={t.id}>{t.name}{t.manager_id === person.id && <small> · lead</small>}</li>)}</ul>}
              </section>
            </div>
          </div>
        )}

        {tab === 'tasks' && (
          <section className="card" aria-label="Tasks">
            <div className="seg ps-seg" role="group" aria-label="Filter tasks">
              {(['open', 'overdue', 'done', 'all'] as const).map((f) => <button key={f} type="button" aria-pressed={taskFilter === f} onClick={() => setTaskFilter(f)}>{f === 'done' ? 'Completed' : label(f)}</button>)}
            </div>
            {shownTasks.length === 0 ? <p className="muted">No tasks here.</p> : (
              <table className="emp-table"><thead><tr><th>Task</th><th>Status</th><th>Priority</th><th>Project</th><th>Due</th></tr></thead>
                <tbody>{shownTasks.map((t) => (
                  <tr key={t.id}><td><Link to={`/tasks/${t.id}`}>{t.title}</Link></td><td><Badge v={t.status} /></td><td>{label(t.priority)}</td><td>{t.projects?.name ?? '—'}</td><td><Due t={t} /></td></tr>))}</tbody></table>)}
          </section>
        )}

        {tab === 'team' && (
          leads.length === 0 ? <div className="card rp-empty"><Users size={28} aria-hidden="true" /><p>{person.name} doesn't lead a team yet.</p></div> : (
            <div className="team-grid">{leads.map((t, i) => {
              const members = tm.filter((m) => m.team_id === t.id);
              return (
                <article key={t.id} className="team-card" style={{ '--i': i } as React.CSSProperties}>
                  <header className="tc-head"><span className="tc-ico"><Users size={18} aria-hidden="true" /></span><span className="grow"><h3>{t.name}</h3>
                    <small className="tc-dept"><Building size={12} aria-hidden="true" />{depts.find((d) => d.id === t.department_id)?.name ?? 'No department'}</small></span></header>
                  <p className="tc-count">{members.length} member{members.length === 1 ? '' : 's'}</p>
                  <ul className="tc-members">{members.map((m) => <li key={m.user_id}><Avatar name={name(m.user_id)} className="avatar xs" /><Link className="grow" to={`/employees/${m.user_id}`}>{name(m.user_id)}</Link></li>)}</ul>
                </article>);
            })}</div>)
        )}

        {tab === 'details' && (
          <section className="card" aria-labelledby="dt-h">
            <h3 id="dt-h">Details</h3>
            <form className="gf-grid ps-form" onSubmit={saveDetails} key={pr.updated_at ?? 'x'}>
              <label>Full name<input name="full_name" defaultValue={pr.full_name ?? ''} maxLength={120} disabled={!canEdit} /></label>
              <label>Job title<input name="job_title" defaultValue={pr.job_title ?? ''} maxLength={120} disabled={!canEdit} /></label>
              <label>Department<select name="department" defaultValue={pr.department ?? ''} disabled={!canEdit}><option value="">None</option>
                {[...new Set([...depts.map((d) => d.name), ...(pr.department ? [pr.department] : [])])].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
              <label>Phone<input name="phone" type="tel" defaultValue={pr.phone ?? ''} maxLength={40} disabled={!canEdit} /></label>
              <label>Location<input name="location" defaultValue={pr.location ?? ''} maxLength={120} disabled={!canEdit} /></label>
              <label>Email<input value={person.email} disabled readOnly /></label>
              {pr.bio && <p className="pf-bio ps-bio">{pr.bio}</p>}
              {canEdit ? <span className="gf-actions"><button type="submit"><CheckCircle2 size={15} aria-hidden="true" />Save details</button></span>
                : <p className="muted">{admin ? "Only an owner can change an owner's details." : 'Only owners and admins can change these details.'}</p>}
            </form>
          </section>
        )}

        {tab === 'access' && admin && (
          <div className="pf-grid">
            <section className="card" aria-labelledby="ac-h">
              <h3 id="ac-h">Role and access</h3>
              <p className="muted">{ROLE_TEXT[person.role as keyof typeof ROLE_TEXT]?.blurb}</p>
              {isMe || !canEdit ? <p className="muted">{isMe ? "You can't change your own role or access." : 'Only an owner can change an owner.'}</p> : (
                <div className="pp-row">
                  <label>Role<select value={person.role} onChange={(e) => setRole(e.target.value)}>
                    {['employee', 'manager', 'admin', ...(myRole === 'owner' ? ['owner'] : [])].map((r) => <option key={r} value={r}>{label(r)}</option>)}</select></label>
                  <button type="button" className={`pill-btn ghost ${person.active ? 'danger-text' : ''}`} onClick={() => setActive(!person.active)}>{person.active ? 'Deactivate' : 'Activate'}</button>
                </div>)}
            </section>
            <section className="card" aria-labelledby="tm-h">
              <h3 id="tm-h">Teams</h3>
              {myTeams.length === 0 ? <p className="muted">Not in any team.</p> : (
                <ul className="pp-chips">{myTeams.map((t) => <li key={t.id}>{t.name}<button type="button" aria-label={`Remove from ${t.name}`} onClick={() => leaveTeam(t)}><X size={13} aria-hidden="true" /></button></li>)}</ul>)}
              {teams.length > myTeams.length && (
                <select aria-label="Add to team" value="" onChange={(e) => e.target.value && joinTeam(e.target.value)}>
                  <option value="">+ Add to a team</option>{teams.filter((t) => !myTeams.some((m) => m.id === t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>)}
            </section>
            {!isMe && canEdit && (
              <section className="card ps-danger" aria-labelledby="dz-h">
                <h3 id="dz-h">Remove from organization</h3>
                <p className="muted">They lose access right away. Their tasks, comments and history stay.</p>
                <button type="button" className="pill-btn ghost danger-text" onClick={removeFromOrg}><UserMinus size={15} aria-hidden="true" />Remove {person.name}</button>
              </section>)}
          </div>
        )}

        {tab === 'activity' && (
          <section className="card" aria-labelledby="act-h">
            <h3 id="act-h">Recent activity</h3>
            {acts.length === 0 ? <p className="muted">No activity recorded yet.</p> : (
              <ul className="timeline">{acts.map((a) => (
                <li key={a.id}><span className="tl-dot" aria-hidden="true" /><span><b>{label(a.action)}</b>{a.entity_type === 'task' && <> · <Link to={`/tasks/${a.entity_id}`}>open task</Link></>}
                  <small className="muted"> {fmtTime(a.created_at)}</small></span></li>))}</ul>)}
          </section>
        )}
      </div>
      <p className="muted ps-foot">Member of {membership!.org_name}{pr.created_at ? ` since ${fmt(pr.created_at)}` : ''}.</p>
    </div>
  );
}
