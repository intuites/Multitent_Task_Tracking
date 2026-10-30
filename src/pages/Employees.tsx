import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Building, Check, Download, Layers, Pencil, Plus, Search, Trash2, UserPlus, Users, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { Badge, download, label, loadPeople, rpc, type Person } from '../lib/ui';
import PersonPanel, { type Perf } from '../components/PersonPanel';
import { ask } from '../components/Dialog';
import { Avatar } from '../components/Frame';
import { ListSkeleton } from '../components/Skeleton';

type Tab = 'people' | 'performance' | 'teams' | 'departments';
const ROLES = ['owner', 'admin', 'manager', 'employee'];

export default function Employees() {
  const { membership, session } = useAuth();
  const orgId = membership!.org_id, uid = session!.user.id, role = membership!.role;
  const admin = can(role, 'members:manage');
  const [tab, setTab] = useState<Tab>('people');
  const [people, setPeople] = useState<Person[] | null>(null);
  const [load, setLoad] = useState<Record<string, { open: number; overdue: number }>>({});
  const [depts, setDepts] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [tm, setTm] = useState<any[]>([]);
  const [inviting, setInviting] = useState(false);
  const [newTeam, setNewTeam] = useState(false);
  const [q, setQ] = useState(''), [roleFilter, setRoleFilter] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [editTeam, setEditTeam] = useState<string | null>(null), [editDept, setEditDept] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setPeople(await loadPeople(orgId, true));
    const day = new Date(); day.setHours(0, 0, 0, 0);
    const [sum, d, t, m, tk] = await Promise.all([
      rpc('tt_org_summary', { p_org: orgId, p_day_start: day.toISOString(), p_day_end: new Date(day.getTime() + 864e5).toISOString() }),
      supabase.from('tt_departments').select('*').eq('org_id', orgId).order('name'),
      supabase.from('tt_teams').select('*').eq('org_id', orgId).order('name'),
      supabase.from('tt_team_members').select('*'),
      // owners/admins get per-person performance, computed from the org's tasks
      admin ? supabase.from('tt_tasks').select('status, due_date, completed_at, tt_task_assignees(user_id)').eq('org_id', orgId).is('archived_at', null).limit(10000) : Promise.resolve({ data: [] as any[] }),
    ]);
    setTasks(tk.data ?? []);
    // workload is aggregated in SQL instead of pulling every assignment to the browser
    const w: Record<string, { open: number; overdue: number }> = {};
    for (const r of sum.workload as any[]) w[r.user_id] = { open: r.open, overdue: r.overdue };
    setLoad(w); setDepts(d.data ?? []); setTeams(t.data ?? []); setTm(m.data ?? []);
  }, [orgId, admin]);
  useEffect(() => { refresh(); }, [refresh]);

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
    setMsg({ kind: 'ok', text: `Invitation sent to ${f.get('email')}.` }); form.reset(); setInviting(false); refresh();
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
  const add = async (table: string, row: object, ok: string) => {
    const { error } = await supabase.from(table).insert(row);
    if (error) fail(/duplicate|unique/i.test(error.message) ? 'That name is already used.' : error.message); else { setMsg({ kind: 'ok', text: ok }); refresh(); }
  };
  async function removeTeam(t: any) {
    if (!(await ask({ title: `Delete team ${t.name}?`, message: 'Members stay in the organization; only the team is removed.', confirmLabel: 'Delete team', danger: true })).ok) return;
    const { error } = await supabase.from('tt_teams').delete().eq('id', t.id);
    if (error) fail(error.message); else refresh();
  }
  async function removeDept(d: any) {
    if (!(await ask({ title: `Delete ${d.name}?`, message: 'Its teams and tasks are kept without a department.', confirmLabel: 'Delete department', danger: true })).ok) return;
    const { error } = await supabase.from('tt_departments').delete().eq('id', d.id);
    if (error) fail(error.message); else refresh();
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
  const selected = sel ? people?.find((p) => p.id === sel) : undefined;
  const changed = (text?: string) => { if (text) setMsg({ kind: 'ok', text }); refresh(); };
  async function update(table: string, id: string, row: object, ok: string) {
    const { error } = await supabase.from(table).update(row).eq('id', id);
    if (error) fail(/duplicate|unique/i.test(error.message) ? 'That name is already used.' : error.message); else { setMsg({ kind: 'ok', text: ok }); refresh(); }
  }

  const nameOf = (id: string) => people?.find((p) => p.id === id)?.name ?? 'Unknown';
  const shown = (people ?? []).filter((p) => (!roleFilter || p.role === roleFilter) && (!q || `${p.name} ${p.email}`.toLowerCase().includes(q.toLowerCase())));
  const managers = (people ?? []).filter((p) => p.active && p.role !== 'employee');
  const TABS: { id: Tab; name: string; n?: number }[] = [{ id: 'people', name: 'People', n: people?.length ?? 0 }, ...(admin ? [{ id: 'performance' as Tab, name: 'Performance' }] : []),
    { id: 'teams', name: 'Teams', n: teams.length }, { id: 'departments', name: 'Departments', n: depts.length }];
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
        <div><h2 className="page-title">Employees &amp; teams</h2><p className="page-sub">Who is in {membership!.org_name}, how they’re grouped, and what they’re working on.</p></div>
        {admin && <div className="page-actions"><button type="button" className="pill-btn" onClick={() => setInviting(!inviting)} aria-expanded={inviting}><UserPlus size={16} aria-hidden="true" />{inviting ? 'Close' : 'Invite people'}</button></div>}
      </div>

      {inviting && (
        <section className="card tpl-edit" aria-labelledby="inv-h">
          <div className="panel-head"><h3 id="inv-h"><UserPlus size={16} aria-hidden="true" /> Invite someone</h3><button type="button" className="icon-btn sm" aria-label="Close" onClick={() => setInviting(false)}><X size={16} aria-hidden="true" /></button></div>
          <form className="inv-form" onSubmit={invite}>
            <label>Email<input name="email" type="email" required placeholder="name@company.com" autoFocus /></label>
            <label>Full name<input name="full_name" placeholder="Optional" /></label>
            <label>Role<select name="role" defaultValue="employee">{['employee', 'manager', 'admin', ...(role === 'owner' ? ['owner'] : [])].map((r) => <option key={r} value={r}>{label(r)}</option>)}</select></label>
            <button type="submit">Send invite</button>
          </form>
          <p className="muted tpl-note">They get an email to set a password, then land straight in this organization.</p>
        </section>
      )}
      {msg && <p key={msg.text} role={msg.kind === 'error' ? 'alert' : 'status'} className={`auth-msg ${msg.kind}`}>{msg.kind === 'error' ? <X size={17} aria-hidden="true" /> : <Check size={17} aria-hidden="true" />}<span>{msg.text}</span></p>}

      <div className="rp-tabs" role="tablist" aria-label="Sections">
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
                    <td>{admin
                      ? <button type="button" className="emp-person emp-open" onClick={() => setSel(p.id)} aria-label={`Manage ${p.name}`}><Avatar name={p.name} /><span><b>{p.name}{p.id === uid && <small className="muted"> (you)</small>}</b><small className="muted">{p.email}</small></span></button>
                      : <span className="emp-person"><Avatar name={p.name} /><span><b>{p.name}{p.id === uid && <small className="muted"> (you)</small>}</b><small className="muted">{p.email}</small></span></span>}</td>
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
            <div className="panel-head"><h3 id="pi-h">Everyone</h3>
              <button type="button" className="mini-link" onClick={() => download('performance.csv', perfRows.map(({ p, s }) => ({ Name: p.name, Email: p.email, Role: label(p.role), Active: p.active ? 'Yes' : 'No', Assigned: s.assigned, Open: s.open, Completed: s.done, Overdue: s.overdue, 'On time %': s.onTime ?? '', 'Completed last 30 days': s.last30 })))}><Download size={15} aria-hidden="true" />Export CSV</button></div>
            <table className="emp-table"><thead><tr><th>Person</th><th>Role</th><th>Assigned</th><th>Completed</th><th>Overdue</th><th>On time</th><th>Progress</th></tr></thead>
              <tbody>{[...perfRows].sort((a, b) => b.s.done - a.s.done).map(({ p, s }) => (
                <tr key={p.id} className={p.active ? '' : 'inactive'}>
                  <td><button type="button" className="emp-person emp-open" onClick={() => setSel(p.id)} aria-label={`Manage ${p.name}`}><Avatar name={p.name} /><span><b>{p.name}</b><small className="muted">{p.email}</small></span></button></td>
                  <td><span className="prio">{label(p.role)}</span></td><td>{s.assigned}</td><td>{s.done}</td><td className={s.overdue ? 'overdue' : ''}>{s.overdue}</td><td>{s.onTime === null ? '—' : `${s.onTime}%`}</td>
                  <td className="perf-bar"><span className="meter" role="img" aria-label={`${pct(s)}% completed`}><i style={{ width: `${pct(s)}%` }} /></span></td>
                </tr>))}</tbody></table>
          </section>
        </>)}

        {tab === 'teams' && (<>
          {can(role, 'task:write') && (newTeam ? (
            <section className="card glass-form" aria-labelledby="nt-h">
              <div className="panel-head"><h3 id="nt-h"><Users size={16} aria-hidden="true" /> New team</h3><button type="button" className="icon-btn sm" aria-label="Close" onClick={() => setNewTeam(false)}><X size={16} aria-hidden="true" /></button></div>
              <form className="gf-grid" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const n = String(f.get('name')).trim(); add('tt_teams', { org_id: orgId, name: n, department_id: f.get('dept') || null, manager_id: f.get('manager') || null }, `Team ${n} created.`); setNewTeam(false); }}>
                <label>Team name<input name="name" required maxLength={120} autoFocus placeholder="e.g. Platform" /></label>
                <label>Department<select name="dept"><option value="">None</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
                <label>Team lead<select name="manager"><option value="">None</option>{managers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                <span className="gf-actions"><button type="submit"><Check size={15} aria-hidden="true" />Create team</button></span>
              </form>
            </section>
          ) : <p><button type="button" className="pill-btn ghost" onClick={() => setNewTeam(true)}><Plus size={15} aria-hidden="true" />New team</button></p>)}
          {teams.length === 0 ? <div className="card rp-empty"><Users size={28} aria-hidden="true" /><p>No teams yet. Teams decide who a task’s lead is.</p></div> : (
            <div className="team-grid">{teams.map((t, i) => {
              const members = tm.filter((m) => m.team_id === t.id);
              const dept = depts.find((d) => d.id === t.department_id);
              const editing = editTeam === t.id;
              return (
                <article key={t.id} className={`team-card ${editing ? 'editing' : ''}`} style={{ '--i': i } as React.CSSProperties}>
                  <header className="tc-head">
                    <span className="tc-ico"><Users size={18} aria-hidden="true" /></span>
                    <span className="grow"><h3>{t.name}</h3><small className="tc-dept"><Building size={12} aria-hidden="true" />{dept?.name ?? 'No department'}</small></span>
                    {can(role, 'task:write') && <span className="row-actions">
                      <button type="button" className={`icon-btn sm ${editing ? 'on' : ''}`} aria-label={`Edit team ${t.name}`} aria-pressed={editing} onClick={() => setEditTeam(editing ? null : t.id)}><Pencil size={14} aria-hidden="true" /></button>
                      <button type="button" className="icon-btn sm danger-text" aria-label={`Delete team ${t.name}`} onClick={() => removeTeam(t)}><Trash2 size={14} aria-hidden="true" /></button></span>}
                  </header>
                  {editing ? (
                    <form className="gf-grid one" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); update('tt_teams', t.id, { name: String(f.get('name')).trim(), department_id: f.get('dept') || null, manager_id: f.get('manager') || null }, 'Team updated.'); setEditTeam(null); }}>
                      <label>Name<input name="name" defaultValue={t.name} required maxLength={120} autoFocus /></label>
                      <label>Department<select name="dept" defaultValue={t.department_id ?? ''}><option value="">None</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
                      <label>Team lead<select name="manager" defaultValue={t.manager_id ?? ''}><option value="">None</option>{managers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                      <span className="gf-actions"><button type="button" className="link" onClick={() => setEditTeam(null)}>Cancel</button><button type="submit"><Check size={15} aria-hidden="true" />Save team</button></span>
                    </form>
                  ) : (<>
                    <div className="tc-lead">{t.manager_id ? <><Avatar name={nameOf(t.manager_id)} className="avatar xs" /><span><small>Team lead</small><b>{nameOf(t.manager_id)}</b></span></> : <span className="muted">No team lead yet</span>}</div>
                    <p className="tc-count">{members.length} member{members.length === 1 ? '' : 's'}</p>
                    {members.length > 0 && <ul className="tc-members">{members.map((m) => (
                      <li key={m.user_id}><Avatar name={nameOf(m.user_id)} className="avatar xs" /><span className="grow">{nameOf(m.user_id)}</span>
                        {can(role, 'task:write') && <button type="button" className="tc-x" aria-label={`Remove ${nameOf(m.user_id)} from ${t.name}`} onClick={async () => {
                          if (!(await ask({ title: 'Remove from team?', message: `${nameOf(m.user_id)} will be removed from ${t.name}. Their tasks stay assigned.`, confirmLabel: 'Remove', danger: true })).ok) return;
                          await supabase.from('tt_team_members').delete().eq('team_id', t.id).eq('user_id', m.user_id); refresh();
                        }}><X size={13} aria-hidden="true" /></button>}
                      </li>))}</ul>}
                    {can(role, 'task:write') && (
                      <select className="tc-add" aria-label={`Add member to ${t.name}`} value="" onChange={(e) => e.target.value && add('tt_team_members', { team_id: t.id, user_id: e.target.value }, 'Member added.')}>
                        <option value="">+ Add member</option>{(people ?? []).filter((p) => p.active && !members.some((m) => m.user_id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>)}
                  </>)}
                </article>);
            })}</div>)}
        </>)}

        {tab === 'departments' && (<>
          {admin && <form className="card dept-new" onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget, n = String(new FormData(form).get('name')).trim(); if (n) { add('tt_departments', { org_id: orgId, name: n }, `Department ${n} added.`); form.reset(); } }}>
            <span className="tc-ico"><Layers size={18} aria-hidden="true" /></span>
            <input aria-label="New department name" name="name" placeholder="New department, e.g. Finance" maxLength={120} /><button type="submit"><Plus size={15} aria-hidden="true" />Add department</button></form>}
          {depts.length === 0 ? <div className="card rp-empty"><Layers size={28} aria-hidden="true" /><p>No departments yet.</p></div> : (
            <div className="team-grid">{depts.map((d, i) => {
              const dt = teams.filter((t) => t.department_id === d.id);
              const people = new Set(tm.filter((m) => dt.some((t) => t.id === m.team_id)).map((m) => m.user_id)).size;
              const others = teams.filter((t) => t.department_id !== d.id);
              return (
                <article key={d.id} className="team-card dept-card" style={{ '--i': i } as React.CSSProperties}>
                  <header className="tc-head">
                    <span className="tc-ico alt"><Layers size={18} aria-hidden="true" /></span>
                    {editDept === d.id
                      ? <form className="dept-rename grow" onSubmit={(e) => { e.preventDefault(); const n = String(new FormData(e.currentTarget).get('name')).trim(); if (n) update('tt_departments', d.id, { name: n }, 'Department renamed.'); setEditDept(null); }}>
                          <input aria-label={`New name for ${d.name}`} name="name" defaultValue={d.name} maxLength={120} autoFocus />
                          <button type="submit" className="icon-btn sm" aria-label="Save name"><Check size={15} aria-hidden="true" /></button>
                          <button type="button" className="icon-btn sm" aria-label="Cancel" onClick={() => setEditDept(null)}><X size={15} aria-hidden="true" /></button></form>
                      : <span className="grow"><h3>{d.name}</h3><small className="muted">{dt.length} team{dt.length === 1 ? '' : 's'} · {people} {people === 1 ? 'person' : 'people'}</small></span>}
                    {admin && editDept !== d.id && <span className="row-actions">
                      <button type="button" className="icon-btn sm" aria-label={`Rename ${d.name}`} onClick={() => setEditDept(d.id)}><Pencil size={14} aria-hidden="true" /></button>
                      <button type="button" className="icon-btn sm danger-text" aria-label={`Delete ${d.name}`} onClick={() => removeDept(d)}><Trash2 size={14} aria-hidden="true" /></button></span>}
                  </header>
                  {dt.length === 0 ? <p className="muted tc-count">No teams in this department yet.</p> : (
                    <ul className="dept-teams">{dt.map((t) => {
                      const n = tm.filter((m) => m.team_id === t.id).length;
                      return (
                        <li key={t.id}><Users size={14} aria-hidden="true" /><span className="grow"><b>{t.name}</b><small className="muted">{n} member{n === 1 ? '' : 's'}{t.manager_id ? ` · lead ${nameOf(t.manager_id)}` : ''}</small></span>
                          {can(role, 'task:write') && <button type="button" className="tc-x" aria-label={`Take ${t.name} out of ${d.name}`} title="Take out of this department"
                            onClick={() => update('tt_teams', t.id, { department_id: null }, `${t.name} is no longer in ${d.name}.`)}><X size={13} aria-hidden="true" /></button>}
                        </li>);
                    })}</ul>)}
                  {can(role, 'task:write') && (
                    <div className="dept-add">
                      {others.length > 0 && <select aria-label={`Add a team to ${d.name}`} value="" onChange={(e) => { const t = teams.find((x) => x.id === e.target.value); if (t) update('tt_teams', t.id, { department_id: d.id }, `${t.name} moved to ${d.name}.`); }}>
                        <option value="">+ Add existing team</option>{others.map((t) => <option key={t.id} value={t.id}>{t.name}{t.department_id ? ` (now in ${depts.find((x) => x.id === t.department_id)?.name ?? 'another'})` : ''}</option>)}
                      </select>}
                      <form className="dept-quick" onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget, n = String(new FormData(form).get('team')).trim(); if (n) { add('tt_teams', { org_id: orgId, name: n, department_id: d.id }, `Team ${n} created in ${d.name}.`); form.reset(); } }}>
                        <input name="team" aria-label={`New team in ${d.name}`} placeholder="New team name" maxLength={120} /><button type="submit" className="icon-btn sm" aria-label="Create team"><Plus size={15} aria-hidden="true" /></button>
                      </form>
                    </div>)}
                </article>);
            })}</div>)}
        </>)}
      </div>
      {selected && <PersonPanel person={selected} perf={perfOf(selected.id)} orgId={orgId} myRole={role} isMe={selected.id === uid} teams={teams} teamMembers={tm} depts={depts}
        onClose={() => setSel(null)} onChanged={changed} setRole={setRole} setActive={setActive} />}
    </>
  );
}
