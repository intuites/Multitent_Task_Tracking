import TabThumb from '../components/TabThumb';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Building2, Check, Layers, Pencil, Plus, Search, Trash2, UserPlus, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { pickName } from '../lib/names';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { Badge, fetchAll, label, loadInvites, loadPeople, rpc, type Person } from '../lib/ui';
import { Link, useLocation } from 'react-router-dom';
import { ask } from '../components/Dialog';
import { Avatar } from '../components/Frame';
import { ListSkeleton } from '../components/Skeleton';

interface Perf { assigned: number; open: number; done: number; overdue: number; onTime: number | null; last30: number }
export type Msg = { kind: 'ok' | 'error'; text: string } | null;
type Tab = 'people' | 'performance' | 'departments' | 'invited';
const ROLES = ['admin', 'employee'];

export default function Employees() {
  const { membership, session } = useAuth();
  const orgId = membership!.org_id, uid = session!.user.id, role = membership!.role;
  const admin = can(role, 'members:manage');
  const [tab, setTab] = useState<Tab>('people');
  const [people, setPeople] = useState<Person[] | null>(null);
  const [load, setLoad] = useState<Record<string, { open: number; overdue: number }>>({});
  const [inviting, setInviting] = useState(false);
  // /employees?invite=1 (the C then I shortcut) opens the invite form
  const { search } = useLocation();
  useEffect(() => { if (new URLSearchParams(search).get('invite') === '1') setInviting(true); }, [search]);
  const [q, setQ] = useState(''), [roleFilter, setRoleFilter] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [tasks, setTasks] = useState<any[]>([]);

  // null: the database can't tell invited people apart yet (migration 0046 not run)
  const [invites, setInvites] = useState<Awaited<ReturnType<typeof loadInvites>> | null>([]);
  const refresh = useCallback(async () => {
    setPeople(await loadPeople(orgId, true));
    if (admin) loadInvites(orgId).then(setInvites, () => setInvites(null));
    const day = new Date(); day.setHours(0, 0, 0, 0);
    const [sum, tk] = await Promise.all([
      rpc('tt_org_summary', { p_org: orgId, p_day_start: day.toISOString(), p_day_end: new Date(day.getTime() + 864e5).toISOString() }),
      // owners/admins get per-person performance, computed from the org's tasks
      admin ? fetchAll(() => supabase.from('tt_tasks').select('id, title, status, priority, department_id, due_date, start_date, created_at, completed_at, tt_task_assignees(user_id)').eq('org_id', orgId).is('archived_at', null).order('id')).then((data) => ({ data }), () => ({ data: [] as any[] })) : Promise.resolve({ data: [] as any[] }),
    ]);
    setTasks(tk.data ?? []);
    // workload is aggregated in SQL instead of pulling every assignment to the browser
    const w: Record<string, { open: number; overdue: number }> = {};
    for (const r of sum.workload as any[]) w[r.user_id] = { open: r.open, overdue: r.overdue };
    setLoad(w);
  }, [orgId, admin]);
  useEffect(() => { refresh().catch((x: Error) => fail(`Couldn't load workload: ${x.message}`)); }, [refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const fail = (text: string) => setMsg({ kind: 'error', text });
  const log = (action: string, detail: object) => supabase.from('tt_activity_logs').insert({ org_id: orgId, actor_id: uid, entity_type: 'organization', entity_id: orgId, action, detail });

  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget, f = new FormData(form);
    setMsg(null);
    const { data: s } = await supabase.auth.getSession();
    const r = await fetch('/api/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token}` },
      body: JSON.stringify({ org_id: orgId, email: f.get('email'), full_name: f.get('full_name'), role: f.get('role') }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return fail(j.error ?? 'Invite failed');
    setMsg({ kind: 'ok', text: `Invitation sent to ${f.get('email')}. They wait under Invited until they set their password, then join People.` }); form.reset(); setInviting(false); setTab('invited'); refresh();
  }
  async function cancelInvite(i: { id: string; email: string }) {
    if (!(await ask({ title: `Cancel the invitation to ${i.email}?`, message: 'They won\'t join this organization. You can invite them again later.', confirmLabel: 'Cancel invitation', danger: true })).ok) return;
    const { error } = await supabase.from('tt_org_members').delete().eq('org_id', orgId).eq('user_id', i.id).is('joined_at', null);
    if (error) return fail(error.message);
    await log('invitation_cancelled', { user: i.id });
    setMsg({ kind: 'ok', text: `The invitation to ${i.email} was cancelled.` }); refresh();
  }
  async function setRole(p: Person, newRole: string) {
    const { error } = await supabase.from('tt_org_members').update({ role: newRole }).eq('org_id', orgId).eq('user_id', p.id);
    if (error) return fail(error.message);
    await log('role_changed', { user: p.id, to: newRole });
    setMsg({ kind: 'ok', text: `${p.name} is now ${label(newRole)}.` }); refresh();
  }
  async function setActive(p: Person, on: boolean) {
    if (!on && !(await ask({ title: `Deactivate ${p.name}?`, message: 'They lose access immediately. Their tasks stay in place.', confirmLabel: 'Deactivate', danger: true })).ok) return;
    const { error } = await supabase.from('tt_org_members').update({ active: on }).eq('org_id', orgId).eq('user_id', p.id);
    if (error) return fail(error.message);
    await log(on ? 'member_activated' : 'member_deactivated', { user: p.id });
    refresh();
  }

  // per-person performance: assigned, open, completed, overdue, on-time rate, completed in the last 30 days
  const perf = useMemo(() => {
    const m: Record<string, Perf & { late: number }> = {}, now = Date.now(), month = now - 30 * 864e5;
    for (const t of tasks) for (const a of t.tt_task_assignees ?? []) {
      const p = (m[a.user_id] ??= { assigned: 0, open: 0, done: 0, overdue: 0, onTime: null, last30: 0, late: 0 });
      p.assigned++;
      if (t.status === 'completed' || t.status === 'completed_cycle') {
        p.done++;
        if (t.completed_at && Date.parse(t.completed_at) >= month) p.last30++;
        if (t.due_date && t.completed_at && Date.parse(t.completed_at) > Date.parse(t.due_date)) p.late++;
      } else { p.open++; if (t.due_date && Date.parse(t.due_date) < now) p.overdue++; }
    }
    for (const p of Object.values(m)) p.onTime = p.done ? Math.round(((p.done - p.late) / p.done) * 100) : null;
    return m;
  }, [tasks]);
  const perfOf = (id: string): Perf => perf[id] ?? { assigned: 0, open: 0, done: 0, overdue: 0, onTime: null, last30: 0 };

  const shown = (people ?? []).filter((p) => (!roleFilter || p.role === roleFilter) && (!q || `${p.name} ${p.email}`.toLowerCase().includes(q.toLowerCase())));
  const TABS: { id: Tab; name: string; n?: number }[] = [{ id: 'people', name: 'People', n: people?.length ?? 0 }, ...(admin ? [{ id: 'performance' as Tab, name: 'Performance' }] : []),
    { id: 'departments', name: 'Departments' }, ...(admin ? [{ id: 'invited' as Tab, name: 'Invited', n: invites?.length ?? 0 }] : [])];
  const perfRows = (people ?? []).map((p) => ({ p, s: perfOf(p.id) }));
  const sumOf = (rows: typeof perfRows) => {
    const done = rows.reduce((n, { s }) => n + s.done, 0), ok = rows.reduce((n, { s }) => n + (s.onTime === null ? 0 : Math.round((s.onTime / 100) * s.done)), 0);
    return { assigned: rows.reduce((n, { s }) => n + s.assigned, 0), open: rows.reduce((n, { s }) => n + s.open, 0), done, overdue: rows.reduce((n, { s }) => n + s.overdue, 0), onTime: done ? Math.round((ok / done) * 100) : null };
  };
  const tot = sumOf(perfRows);
  const byRole = ROLES.map((r) => { const rs = perfRows.filter(({ p }) => p.role === r); return { r, people: rs.length, ...sumOf(rs) }; }).filter((x) => x.people);
  const pct = (s: Perf) => (s.assigned ? Math.round((s.done / s.assigned) * 100) : 0);

  return (
    <>
      <div className="page-head">
        <div><h2 className="page-title">Employees</h2><p className="page-sub">Who is in {membership!.org_name}, which departments they belong to, and what they’re working on.</p></div>
        {admin && <div className="page-actions"><button type="button" className="pill-btn" onClick={() => setInviting(!inviting)} aria-expanded={inviting}><UserPlus size={16} aria-hidden="true" />{inviting ? 'Close' : 'Invite people'}</button></div>}
      </div>

      {inviting && (
        <section className="card tpl-edit" aria-labelledby="inv-h">
          <div className="panel-head"><h3 id="inv-h"><UserPlus size={16} aria-hidden="true" /> Invite someone</h3><button type="button" className="icon-btn sm" aria-label="Close" onClick={() => setInviting(false)}><X size={16} aria-hidden="true" /></button></div>
          <form className="inv-form" onSubmit={invite}>
            <label>Email<input name="email" type="email" required placeholder="name@company.com" autoFocus /></label>
            <label>Full name<input name="full_name" placeholder="Optional" /></label>
            <label>Role<select name="role" defaultValue="employee">{['employee', 'admin'].map((r) => <option key={r} value={r}>{label(r)}</option>)}</select></label>
            <button type="submit">Send invite</button>
          </form>
          <p className="muted tpl-note">They get an email to set a password. They become a member, and appear in the list, once they've done that.</p>
        </section>
      )}
      {msg && <p key={msg.text} role={msg.kind === 'error' ? 'alert' : 'status'} className={`auth-msg ${msg.kind}`}>{msg.kind === 'error' ? <X size={17} aria-hidden="true" /> : <Check size={17} aria-hidden="true" />}<span>{msg.text}</span></p>}

      <div className="rp-tabs" role="tablist" aria-label="Sections">
        <TabThumb />
        {TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.name}{t.n !== undefined && <span className="tab-n">{t.n}</span>}</button>)}
      </div>

      <div key={tab} className="pf-panel">
        {tab === 'people' && (
          <section className="card" aria-label="People">
            <div className="emp-tools">
              <span className="emp-search"><Search size={16} aria-hidden="true" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" aria-label="Search people" /></span>
              <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Filter by role"><option value="">All roles</option>{ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}</select>
            </div>
            {people === null ? <ListSkeleton /> : shown.length === 0 ? <p className="muted">Nobody matches.</p> : (
              <table className="emp-table">
                <thead><tr><th>Person</th><th>Role</th><th>Open</th><th>Overdue</th><th>Status</th>{admin && <th><span className="sr-only">Actions</span></th>}</tr></thead>
                <tbody>{shown.map((p) => (
                  <tr key={p.id} className={p.active ? '' : 'inactive'}>
                    <td><Link to={`/employees/${p.id}`} className="emp-person emp-open" title={`Open ${p.name}'s profile`}><Avatar name={p.name} url={p.avatar} /><span><b>{p.name}{p.id === uid && <small className="muted"> (you)</small>}</b><small className="muted">{p.email}</small></span></Link></td>
                    <td>{admin && p.id !== uid ? (
                      <select aria-label={`Role for ${p.name}`} value={p.role} onChange={(e) => setRole(p, e.target.value)}>
                        {ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}
                      </select>) : <span className="prio">{label(p.role)}</span>}</td>
                    <td>{load[p.id]?.open ?? 0}</td>
                    <td className={load[p.id]?.overdue ? 'overdue' : ''}>{load[p.id]?.overdue ?? 0}</td>
                    <td><Badge v={p.active ? 'active' : 'inactive'} /></td>
                    {admin && <td>{p.id !== uid && <button type="button" className={p.active ? 'link danger-text' : 'link'} onClick={() => setActive(p, !p.active)}>{p.active ? 'Deactivate' : 'Activate'}</button>}</td>}
                  </tr>))}</tbody>
              </table>)}
          </section>
        )}
        {tab === 'invited' && admin && (
          <section className="card" aria-labelledby="wait-h">
            <div className="panel-head"><h3 id="wait-h">Invited, waiting to join</h3></div>
            <p className="muted">Not members yet. Each person joins the moment they open the invitation email and set a password, and then moves to People. Until then they can't be assigned tasks and get no emails.</p>
            {invites === null ? (
              <p className="note">To keep invited people out of People until they set a password, run the database update (migration 0046). Until then they show as members straight away.</p>
            ) : invites.length === 0 ? <p className="muted">No one is waiting. Everyone you invited has joined.</p> : (
              <ul className="help-list">{invites.map((i) => (
                <li key={i.id}><span className="grow"><b>{i.email}</b><small className="muted">{label(i.role === 'owner' ? 'admin' : i.role)}, invited {new Date(i.invited).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</small></span>
                  <span className="prio">Waiting</span>
                  <button type="button" className="link danger-text" onClick={() => cancelInvite(i)}>Cancel invitation</button></li>))}</ul>)}
          </section>
        )}

        {tab === 'performance' && admin && (<>
          <div className="perf-kpis">
            {([['People', (people ?? []).filter((p) => p.active).length], ['Tasks assigned', tot.assigned], ['Open', tot.open], ['Completed', tot.done], ['Overdue', tot.overdue], ['On time', tot.onTime === null ? '—' : `${tot.onTime}%`]] as const)
              .map(([k, v], i) => <div key={k} className="perf-kpi" style={{ '--i': i } as React.CSSProperties}><b>{v}</b><small>{k}</small></div>)}
          </div>
          <section className="card" aria-labelledby="pr-h">
            <div className="panel-head"><h3 id="pr-h">By role</h3></div>
            <table className="emp-table"><thead><tr><th>Role</th><th>People</th><th>Open</th><th>Completed</th><th>Overdue</th><th>On time</th></tr></thead>
              <tbody>{byRole.map((x) => <tr key={x.r}><td><span className="prio">{label(x.r)}</span></td><td>{x.people}</td><td>{x.open}</td><td>{x.done}</td><td className={x.overdue ? 'overdue' : ''}>{x.overdue}</td><td>{x.onTime === null ? '—' : `${x.onTime}%`}</td></tr>)}</tbody></table>
          </section>
          <section className="card" aria-labelledby="pi-h">
            <div className="panel-head"><h3 id="pi-h">Everyone</h3></div>
            <table className="emp-table"><thead><tr><th>Person</th><th>Role</th><th>Assigned</th><th>Completed</th><th>Overdue</th><th>On time</th><th>Progress</th></tr></thead>
              <tbody>{[...perfRows].sort((a, b) => b.s.done - a.s.done).map(({ p, s }) => (
                <tr key={p.id} className={p.active ? '' : 'inactive'}>
                  <td><Link to={`/employees/${p.id}`} className="emp-person emp-open" title={`Open ${p.name}'s profile`}><Avatar name={p.name} url={p.avatar} /><span><b>{p.name}</b><small className="muted">{p.email}</small></span></Link></td>
                  <td><span className="prio">{label(p.role)}</span></td><td>{s.assigned}</td><td>{s.done}</td><td className={s.overdue ? 'overdue' : ''}>{s.overdue}</td><td>{s.onTime === null ? '—' : `${s.onTime}%`}</td>
                  <td className="perf-bar"><span className="meter" role="img" aria-label={`${pct(s)}% completed`}><i style={{ width: `${pct(s)}%` }} /></span></td>
                </tr>))}</tbody></table>
          </section>
        </>)}

        {tab === 'departments' && <Departments say={setMsg} />}
      </div>
    </>
  );
}

/** Organization → its departments → each department's members. Owners and admins of that organization can edit. */
export function Departments({ say }: { say: (m: Msg) => void }) {
  const { membership, memberships, session } = useAuth();
  const orgs = memberships.filter((m) => can(m.role, 'task:write'));
  const [orgId, setOrgId] = useState(membership!.org_id);
  const admin = can(orgs.find((m) => m.org_id === orgId)?.role, 'members:manage');
  const [depts, setDepts] = useState<any[] | null>(null);
  const [dm, setDm] = useState<{ department_id: string; user_id: string }[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [editDept, setEditDept] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [d, m, p] = await Promise.all([
      supabase.from('tt_departments').select('*').eq('org_id', orgId).order('name'),
      supabase.from('tt_department_members').select('department_id, user_id').eq('org_id', orgId),
      loadPeople(orgId),
    ]);
    setDepts(d.data ?? []); setDm(m.data ?? []); setPeople(p.filter((x) => x.active));
  }, [orgId]);
  useEffect(() => { setDepts(null); refresh(); }, [refresh]);

  const run = async (q: PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    const { error } = await q;
    if (error) say({ kind: 'error', text: /duplicate|unique/i.test(error.message) ? 'That name is already used.' : /tt_department_members/.test(error.message) ? 'Department members need the database update (migration 0019).' : error.message });
    else { say({ kind: 'ok', text: ok }); refresh(); }
  };
  async function removeDept(d: any) {
    if (!(await ask({ title: `Delete ${d.name}?`, message: 'Its members stay in the organization and its tasks are kept without a department.', confirmLabel: 'Delete department', danger: true })).ok) return;
    run(supabase.from('tt_departments').delete().eq('id', d.id), `Deleted ${d.name}.`);
  }
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? 'Removed member';

  return (<>
    <div className="card dept-new">
      <span className="tc-ico"><Building2 size={18} aria-hidden="true" /></span>
      <label className="dept-org">Organization<select value={orgId} onChange={(e) => setOrgId(e.target.value)}>{orgs.map((m) => <option key={m.org_id} value={m.org_id}>{m.org_name}</option>)}</select></label>
      {admin && <form className="dept-quick grow" onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget, n = String(new FormData(form).get('name')).trim(); if (n) { run(supabase.from('tt_departments').insert({ org_id: orgId, name: n }), `Department ${n} added.`); form.reset(); } }}>
        <input aria-label="New department name" name="name" placeholder="New department, e.g. Finance" maxLength={120} /><button type="submit"><Plus size={15} aria-hidden="true" />Add department</button></form>}
    </div>
    {depts === null ? <ListSkeleton /> : depts.length === 0 ? <div className="card rp-empty"><Layers size={28} aria-hidden="true" /><p>No departments in this organization yet.{admin && ' Add one above, then add its members.'}</p></div> : (
      <div className="team-grid">{depts.map((d, i) => {
        const members = dm.filter((m) => m.department_id === d.id);
        return (
          <article key={d.id} className="team-card dept-card" style={{ '--i': i } as React.CSSProperties}>
            <header className="tc-head">
              <span className="tc-ico alt"><Layers size={18} aria-hidden="true" /></span>
              {editDept === d.id
                ? <form className="dept-rename grow" onSubmit={(e) => { e.preventDefault(); const n = String(new FormData(e.currentTarget).get('name')).trim(); if (n) run(supabase.from('tt_departments').update({ name: n }).eq('id', d.id), 'Department renamed.'); setEditDept(null); }}>
                    <input aria-label={`New name for ${d.name}`} name="name" defaultValue={d.name} maxLength={120} autoFocus />
                    <button type="submit" className="icon-btn sm" aria-label="Save name"><Check size={15} aria-hidden="true" /></button>
                    <button type="button" className="icon-btn sm" aria-label="Cancel" onClick={() => setEditDept(null)}><X size={15} aria-hidden="true" /></button></form>
                : <span className="grow"><h3>{d.name}</h3><small className="muted">{members.length} member{members.length === 1 ? '' : 's'}</small></span>}
              {admin && editDept !== d.id && <span className="row-actions">
                <button type="button" className="icon-btn sm" aria-label={`Rename ${d.name}`} onClick={() => setEditDept(d.id)}><Pencil size={14} aria-hidden="true" /></button>
                <button type="button" className="icon-btn sm danger-text" aria-label={`Delete ${d.name}`} onClick={() => removeDept(d)}><Trash2 size={14} aria-hidden="true" /></button></span>}
            </header>
            {members.length === 0 ? <p className="muted tc-count">No members yet.</p> : (
              <ul className="tc-members">{members.map((m) => (
                <li key={m.user_id}><Avatar name={nameOf(m.user_id)} url={people.find((p) => p.id === m.user_id)?.avatar} className="avatar xs" /><span className="grow">{nameOf(m.user_id)}</span>
                  {admin && <button type="button" className="tc-x" aria-label={`Remove ${nameOf(m.user_id)} from ${d.name}`}
                    onClick={() => run(supabase.from('tt_department_members').delete().eq('department_id', d.id).eq('user_id', m.user_id), `${nameOf(m.user_id)} removed from ${d.name}.`)}><X size={13} aria-hidden="true" /></button>}
                </li>))}</ul>)}
            {admin && (
              <select className="tc-add" aria-label={`Add member to ${d.name}`} value="" onChange={(e) => e.target.value && run(supabase.from('tt_department_members').insert({ department_id: d.id, user_id: e.target.value, org_id: orgId }), `${nameOf(e.target.value)} added to ${d.name}.`)}>
                <option value="">+ Add member</option>{people.filter((p) => !members.some((m) => m.user_id === p.id)).map((p) => <option key={p.id} value={p.id}>{pickName(p, people, session?.user.id)}</option>)}
              </select>)}
          </article>);
      })}</div>)}
  </>);
}
