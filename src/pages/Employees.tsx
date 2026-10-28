import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { Badge, label, loadPeople, rpc, type Person } from '../lib/ui';
import { ask } from '../components/Dialog';

export default function Employees() {
  const { membership, session } = useAuth();
  const orgId = membership!.org_id, uid = session!.user.id, role = membership!.role;
  const admin = can(role, 'members:manage');
  const [people, setPeople] = useState<Person[]>([]);
  const [load, setLoad] = useState<Record<string, { open: number; overdue: number }>>({});
  const [depts, setDepts] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [tm, setTm] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

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

  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget, f = new FormData(form);
    setMsg(''); setError('');
    const { data: s } = await supabase.auth.getSession();
    const r = await fetch('/api/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token}` },
      body: JSON.stringify({ org_id: orgId, email: f.get('email'), full_name: f.get('full_name'), role: f.get('role') }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setError(j.error ?? 'Invite failed');
    setMsg('Invitation sent / member added.'); form.reset(); refresh();
  }
  async function setRole(p: Person, newRole: string) {
    const { error } = await supabase.from('tt_org_members').update({ role: newRole }).eq('org_id', orgId).eq('user_id', p.id);
    if (error) setError(error.message);
    await supabase.from('tt_activity_logs').insert({ org_id: orgId, actor_id: uid, entity_type: 'organization', entity_id: orgId, action: 'role_changed', detail: { user: p.id, to: newRole } });
    refresh();
  }
  async function setActive(p: Person, on: boolean) {
    if (!on && !(await ask({ message: `Deactivate ${p.name}? They lose access immediately.`, confirmLabel: 'Deactivate', danger: true })).ok) return;
    const { error } = await supabase.from('tt_org_members').update({ active: on }).eq('org_id', orgId).eq('user_id', p.id);
    if (error) setError(error.message);
    await supabase.from('tt_activity_logs').insert({ org_id: orgId, actor_id: uid, entity_type: 'organization', entity_id: orgId, action: on ? 'member_activated' : 'member_deactivated', detail: { user: p.id } });
    refresh();
  }
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? 'Unknown';
  const add = async (table: string, row: object) => { const { error } = await supabase.from(table).insert(row); if (error) setError(error.message); else refresh(); };

  return (
    <div className="card">
      <h2>Employees</h2>
      {error && <p role="alert">{error}</p>}{msg && <p>{msg}</p>}
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Open tasks</th><th>Overdue</th><th>Status</th>{admin && <th />}</tr></thead>
        <tbody>{people.map((p) => (
          <tr key={p.id}>
            <td>{p.name}</td><td>{p.email}</td>
            <td>{admin && p.id !== uid ? (
              <select aria-label={`Role for ${p.name}`} value={p.role} onChange={(e) => setRole(p, e.target.value)}>
                {['owner', 'admin', 'manager', 'employee'].map((r) => <option key={r} value={r}>{label(r)}</option>)}
              </select>) : label(p.role)}</td>
            <td>{load[p.id]?.open ?? 0}</td><td className={load[p.id]?.overdue ? 'overdue' : ''}>{load[p.id]?.overdue ?? 0}</td>
            <td><Badge v={p.active ? 'active' : 'inactive'} /></td>
            {admin && <td>{p.id !== uid && <button className="link" onClick={() => setActive(p, !p.active)}>{p.active ? 'Deactivate' : 'Activate'}</button>}</td>}
          </tr>))}</tbody>
      </table>

      {admin && (
        <>
          <h3>Invite employee</h3>
          <form className="grid" onSubmit={invite}>
            <label>Email<input name="email" type="email" required /></label>
            <label>Full name<input name="full_name" /></label>
            <label>Role<select name="role" defaultValue="employee">{['employee', 'manager', 'admin', ...(role === 'owner' ? ['owner'] : [])].map((r) => <option key={r} value={r}>{label(r)}</option>)}</select></label>
            <button type="submit">Send invite</button>
          </form>
        </>
      )}

      <h3>Departments & teams</h3>
      {admin && <form className="row filters" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); add('tt_departments', { org_id: orgId, name: String(f.get('name')).trim() }); e.currentTarget.reset(); }}>
        <input aria-label="New department name" name="name" placeholder="New department" required /><button type="submit">Add department</button></form>}
      {depts.length === 0 ? <p>No departments yet.</p> : <p>Departments: {depts.map((d) => d.name).join(', ')}</p>}
      <form className="row filters" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); add('tt_teams', { org_id: orgId, name: String(f.get('name')).trim(), department_id: f.get('dept') || null, manager_id: f.get('manager') || null }); e.currentTarget.reset(); }}>
        <input aria-label="New team name" name="name" placeholder="New team" required />
        <select aria-label="Department" name="dept"><option value="">No department</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <select aria-label="Team manager" name="manager"><option value="">No manager</option>{people.filter((p) => p.active && p.role !== 'employee').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <button type="submit">Add team</button>
      </form>
      {teams.map((t) => {
        const members = tm.filter((m) => m.team_id === t.id);
        return (
          <div key={t.id} className="note">
            <b>{t.name}</b> <small>{depts.find((d) => d.id === t.department_id)?.name ?? 'no department'} · manager: {t.manager_id ? nameOf(t.manager_id) : '—'}</small>
            <p>{members.map((m) => <span key={m.user_id} className="chip">{nameOf(m.user_id)}
              <button className="link" aria-label="Remove member" onClick={async () => { await supabase.from('tt_team_members').delete().eq('team_id', t.id).eq('user_id', m.user_id); refresh(); }}>×</button></span>)}</p>
            <select aria-label="Add member" value="" onChange={(e) => e.target.value && add('tt_team_members', { team_id: t.id, user_id: e.target.value })}>
              <option value="">+ Add member</option>{people.filter((p) => p.active && !members.some((m) => m.user_id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>);
      })}
    </div>
  );
}
