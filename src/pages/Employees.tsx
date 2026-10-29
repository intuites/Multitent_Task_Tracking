import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Building, Check, Layers, Plus, Search, Trash2, UserPlus, Users, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { Badge, label, loadPeople, rpc, type Person } from '../lib/ui';
import { ask } from '../components/Dialog';
import { Avatar } from '../components/Frame';
import { ListSkeleton } from '../components/Skeleton';

type Tab = 'people' | 'teams' | 'departments';
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

  const refresh = useCallback(async () => {
    setPeople(await loadPeople(orgId, true));
    const day = new Date(); day.setHours(0, 0, 0, 0);
    const [sum, d, t, m] = await Promise.all([
      rpc('tt_org_summary', { p_org: orgId, p_day_start: day.toISOString(), p_day_end: new Date(day.getTime() + 864e5).toISOString() }),
      supabase.from('tt_departments').select('*').eq('org_id', orgId).order('name'),
      supabase.from('tt_teams').select('*').eq('org_id', orgId).order('name'),
      supabase.from('tt_team_members').select('*'),
    ]);
    // workload is aggregated in SQL instead of pulling every assignment to the browser
    const w: Record<string, { open: number; overdue: number }> = {};
    for (const r of sum.workload as any[]) w[r.user_id] = { open: r.open, overdue: r.overdue };
    setLoad(w); setDepts(d.data ?? []); setTeams(t.data ?? []); setTm(m.data ?? []);
  }, [orgId]);
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

  const nameOf = (id: string) => people?.find((p) => p.id === id)?.name ?? 'Unknown';
  const shown = (people ?? []).filter((p) => (!roleFilter || p.role === roleFilter) && (!q || `${p.name} ${p.email}`.toLowerCase().includes(q.toLowerCase())));
  const managers = (people ?? []).filter((p) => p.active && p.role !== 'employee');
  const TABS: { id: Tab; name: string; n: number }[] = [{ id: 'people', name: 'People', n: people?.length ?? 0 }, { id: 'teams', name: 'Teams', n: teams.length }, { id: 'departments', name: 'Departments', n: depts.length }];

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
        {TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.name}<span className="tab-n">{t.n}</span></button>)}
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
                    <td><span className="emp-person"><Avatar name={p.name} /><span><b>{p.name}{p.id === uid && <small className="muted"> (you)</small>}</b><small className="muted">{p.email}</small></span></span></td>
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

        {tab === 'teams' && (<>
          {can(role, 'task:write') && (newTeam ? (
            <section className="card tpl-edit" aria-labelledby="nt-h">
              <h3 id="nt-h"><Users size={16} aria-hidden="true" /> New team</h3>
              <form className="inv-form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const n = String(f.get('name')).trim(); add('tt_teams', { org_id: orgId, name: n, department_id: f.get('dept') || null, manager_id: f.get('manager') || null }, `Team ${n} created.`); setNewTeam(false); }}>
                <label>Team name<input name="name" required maxLength={120} autoFocus /></label>
                <label>Department<select name="dept"><option value="">None</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
                <label>Team lead<select name="manager"><option value="">None</option>{managers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                <span className="row filters"><button type="submit">Create team</button><button type="button" className="link" onClick={() => setNewTeam(false)}>Cancel</button></span>
              </form>
            </section>
          ) : <p><button type="button" className="pill-btn ghost" onClick={() => setNewTeam(true)}><Plus size={15} aria-hidden="true" />New team</button></p>)}
          {teams.length === 0 ? <div className="card rp-empty"><Users size={28} aria-hidden="true" /><p>No teams yet. Teams decide who a task’s lead is.</p></div> : (
            <div className="tpl-grid">{teams.map((t, i) => {
              const members = tm.filter((m) => m.team_id === t.id);
              return (
                <article key={t.id} className="tpl-card" style={{ '--i': i } as React.CSSProperties}>
                  <div className="tpl-top"><h3>{t.name}</h3>{can(role, 'task:write') && <button type="button" className="icon-btn sm danger-text" aria-label={`Delete team ${t.name}`} onClick={() => removeTeam(t)}><Trash2 size={14} aria-hidden="true" /></button>}</div>
                  <ul className="tpl-meta">
                    <li><Building size={14} aria-hidden="true" />{depts.find((d) => d.id === t.department_id)?.name ?? 'No department'}</li>
                    <li><Users size={14} aria-hidden="true" />{members.length} member{members.length === 1 ? '' : 's'}</li>
                  </ul>
                  <p className="team-lead">Lead: <b>{t.manager_id ? nameOf(t.manager_id) : 'not set'}</b></p>
                  <ul className="people">{members.map((m) => (
                    <li key={m.user_id}><Avatar name={nameOf(m.user_id)} className="avatar xs" /><span className="grow">{nameOf(m.user_id)}</span>
                      {can(role, 'task:write') && <button type="button" className="icon-btn sm" aria-label={`Remove ${nameOf(m.user_id)} from ${t.name}`} onClick={async () => {
                        if (!(await ask({ title: 'Remove from team?', message: `${nameOf(m.user_id)} will be removed from ${t.name}. Their tasks stay assigned.`, confirmLabel: 'Remove', danger: true })).ok) return;
                        await supabase.from('tt_team_members').delete().eq('team_id', t.id).eq('user_id', m.user_id); refresh();
                      }}><X size={14} aria-hidden="true" /></button>}
                    </li>))}</ul>
                  {can(role, 'task:write') && (
                    <select aria-label={`Add member to ${t.name}`} value="" onChange={(e) => e.target.value && add('tt_team_members', { team_id: t.id, user_id: e.target.value }, 'Member added.')}>
                      <option value="">+ Add member</option>{(people ?? []).filter((p) => p.active && !members.some((m) => m.user_id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>)}
                </article>);
            })}</div>)}
        </>)}

        {tab === 'departments' && (
          <section className="card" aria-label="Departments">
            {admin && <form className="inline-add" onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget, n = String(new FormData(form).get('name')).trim(); if (n) { add('tt_departments', { org_id: orgId, name: n }, `Department ${n} added.`); form.reset(); } }}>
              <input aria-label="New department name" name="name" placeholder="New department, e.g. Finance" maxLength={120} /><button type="submit"><Plus size={15} aria-hidden="true" />Add department</button></form>}
            {depts.length === 0 ? <p className="muted">No departments yet.</p> : (
              <ul className="people dept-list">{depts.map((d) => {
                const dt = teams.filter((t) => t.department_id === d.id);
                return (
                  <li key={d.id}><Layers size={16} className="muted" aria-hidden="true" /><span className="grow"><b>{d.name}</b><br /><small className="muted">{dt.length ? dt.map((t) => t.name).join(', ') : 'No teams'}</small></span>
                    {admin && <button type="button" className="icon-btn sm danger-text" aria-label={`Delete ${d.name}`} onClick={() => removeDept(d)}><Trash2 size={14} aria-hidden="true" /></button>}
                  </li>);
              })}</ul>)}
          </section>
        )}
      </div>
    </>
  );
}
