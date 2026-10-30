import { useEffect, useState, type FormEvent } from 'react';
import { Check, UserMinus, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { label, rpc, type Person } from '../lib/ui';
import { ask } from './Dialog';
import { Avatar } from './Frame';

export interface Perf { assigned: number; open: number; done: number; overdue: number; onTime: number | null; last30: number }

/** Side panel where an owner/admin manages one person: details, role, access, teams and performance. */
export default function PersonPanel({ person, perf, orgId, myRole, isMe, teams, teamMembers, depts, onClose, onChanged, setRole, setActive }: {
  person: Person; perf: Perf; orgId: string; myRole: string; isMe: boolean; teams: any[]; teamMembers: any[]; depts: any[];
  onClose: () => void; onChanged: (msg?: string) => void; setRole: (p: Person, r: string) => void; setActive: (p: Person, on: boolean) => void;
}) {
  const [pr, setPr] = useState<any>(null);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  // admins can't change owners; owners can change anyone
  const canEdit = myRole === 'owner' || person.role !== 'owner' || isMe;

  useEffect(() => {
    setPr(null); setErr(''); setSaved(false);
    supabase.from('tt_profiles').select('*').eq('user_id', person.id).maybeSingle().then(({ data }) => setPr(data ?? {}));
  }, [person.id]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget), g = (k: string) => String(f.get(k) ?? '');
    setErr(''); setSaved(false);
    try {
      await rpc('tt_admin_update_profile', { p_org: orgId, p_user: person.id, p_full_name: g('full_name'), p_job_title: g('job_title'), p_department: g('department'), p_phone: g('phone'), p_location: g('location') });
      setSaved(true); onChanged(`${g('full_name') || person.name}'s details were saved.`);
    } catch (x) { setErr(/function/i.test((x as Error).message) ? 'Editing other people needs database update 0016.' : (x as Error).message); }
  };
  const mine = teamMembers.filter((m) => m.user_id === person.id).map((m) => teams.find((t) => t.id === m.team_id)).filter(Boolean);
  const addTeam = async (teamId: string) => {
    const { error } = await supabase.from('tt_team_members').insert({ team_id: teamId, user_id: person.id });
    if (error) setErr(error.message); else onChanged('Added to the team.');
  };
  const leaveTeam = async (t: any) => {
    if (!(await ask({ title: `Remove from ${t.name}?`, message: `${person.name}'s tasks stay assigned.`, confirmLabel: 'Remove', danger: true })).ok) return;
    const { error } = await supabase.from('tt_team_members').delete().eq('team_id', t.id).eq('user_id', person.id);
    if (error) setErr(error.message); else onChanged('Removed from the team.');
  };
  const removeFromOrg = async () => {
    if (!(await ask({ title: `Remove ${person.name} from the organization?`, message: 'They lose access right away and leave every team. Their tasks, comments and history stay. You can invite them again later.', confirmLabel: 'Remove person', danger: true })).ok) return;
    await supabase.from('tt_team_members').delete().eq('user_id', person.id).in('team_id', teams.map((t) => t.id));
    const { error } = await supabase.from('tt_org_members').delete().eq('org_id', orgId).eq('user_id', person.id);
    if (error) setErr(error.message); else { onChanged(`${person.name} was removed.`); onClose(); }
  };

  const stats: [string, string | number][] = [['Assigned', perf.assigned], ['Open', perf.open], ['Completed', perf.done], ['Overdue', perf.overdue],
    ['On time', perf.onTime === null ? '—' : `${perf.onTime}%`], ['Done in 30 days', perf.last30]];

  return (
    <div className="pp-wrap" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="pp" role="dialog" aria-modal="true" aria-labelledby="pp-h">
        <header className="pp-head">
          <Avatar name={person.name} url={pr?.avatar_url} />
          <div className="grow"><h3 id="pp-h">{person.name}</h3><small className="muted">{person.email}</small></div>
          <button type="button" className="icon-btn sm" aria-label="Close" onClick={onClose}><X size={16} aria-hidden="true" /></button>
        </header>
        <div className="pp-body">
          <div className="pp-badges"><span className="prio">{label(person.role)}</span><span className={`badge b-${person.active ? 'active' : 'inactive'}`}>{person.active ? 'Active' : 'Inactive'}</span></div>
          {err && <p role="alert" className="form-alert">{err}</p>}

          <section aria-labelledby="pp-perf"><h4 id="pp-perf">Performance</h4>
            <ul className="pp-stats">{stats.map(([k, v]) => <li key={k}><b>{v}</b><small>{k}</small></li>)}</ul>
            <span className="meter" aria-hidden="true"><i style={{ width: `${perf.assigned ? Math.round((perf.done / perf.assigned) * 100) : 0}%` }} /></span>
          </section>

          <section aria-labelledby="pp-det"><h4 id="pp-det">Details</h4>
            {pr === null ? <p className="muted">Loading…</p> : (
              <form className="pp-form" onSubmit={save} key={person.id}>
                <label>Full name<input name="full_name" defaultValue={pr.full_name ?? ''} maxLength={120} disabled={!canEdit} /></label>
                <label>Job title<input name="job_title" defaultValue={pr.job_title ?? ''} maxLength={120} disabled={!canEdit} /></label>
                <label>Department<select name="department" defaultValue={pr.department ?? ''} disabled={!canEdit}><option value="">None</option>
                  {[...new Set([...depts.map((d) => d.name), ...(pr.department ? [pr.department] : [])])].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
                <label>Phone<input name="phone" type="tel" defaultValue={pr.phone ?? ''} maxLength={40} disabled={!canEdit} /></label>
                <label>Location<input name="location" defaultValue={pr.location ?? ''} maxLength={120} disabled={!canEdit} /></label>
                {canEdit ? <span className="row filters"><button type="submit">Save details</button>{saved && <small className="ok-note"><Check size={14} aria-hidden="true" />Saved</small>}</span>
                  : <p className="muted">Only an owner can change an owner's details.</p>}
              </form>)}
          </section>

          {!isMe && canEdit && (
            <section aria-labelledby="pp-acc"><h4 id="pp-acc">Access</h4>
              <div className="pp-row">
                <label>Role<select value={person.role} onChange={(e) => setRole(person, e.target.value)}>
                  {['employee', 'manager', 'admin', ...(myRole === 'owner' ? ['owner'] : [])].map((r) => <option key={r} value={r}>{label(r)}</option>)}</select></label>
                <button type="button" className={`pill-btn ghost ${person.active ? 'danger-text' : ''}`} onClick={() => setActive(person, !person.active)}>{person.active ? 'Deactivate' : 'Activate'}</button>
              </div>
            </section>)}

          <section aria-labelledby="pp-teams"><h4 id="pp-teams">Teams</h4>
            {mine.length === 0 ? <p className="muted">Not in any team.</p> : (
              <ul className="pp-chips">{mine.map((t: any) => <li key={t.id}>{t.name}<button type="button" aria-label={`Remove from ${t.name}`} onClick={() => leaveTeam(t)}><X size={13} aria-hidden="true" /></button></li>)}</ul>)}
            {teams.length > mine.length && (
              <select aria-label="Add to team" value="" onChange={(e) => e.target.value && addTeam(e.target.value)}>
                <option value="">+ Add to a team</option>{teams.filter((t) => !mine.some((m: any) => m.id === t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>)}
          </section>

          {!isMe && canEdit && (
            <section className="pp-danger"><button type="button" className="pill-btn ghost danger-text" onClick={removeFromOrg}><UserMinus size={15} aria-hidden="true" />Remove from organization</button></section>)}
        </div>
      </aside>
    </div>
  );
}
