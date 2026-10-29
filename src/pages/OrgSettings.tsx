import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRightLeft, Building2, Check, Globe2, Layers, Lock, Pencil, Plus, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { fmt, label } from '../lib/ui';
import { ROLE_TEXT } from '../lib/roles';
import { ask } from '../components/Dialog';
import { PageSkeleton } from '../components/Skeleton';

const ROLES = ['owner', 'admin', 'manager', 'employee'] as const;
// every IANA zone the browser knows; falls back to a short US-first list on old browsers
const ZONES: string[] = (() => {
  try { return (Intl as any).supportedValuesOf('timeZone'); } catch { return ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'UTC', 'Europe/London', 'Asia/Kolkata']; }
})();

export default function OrgSettings() {
  const { membership, memberships, switchOrg, session, refresh } = useAuth();
  const orgId = membership!.org_id, role = membership!.role, uid = session!.user.id;
  const canEdit = can(role, 'org:manage');
  const navigate = useNavigate();
  const [org, setOrg] = useState<any>(null);
  const [depts, setDepts] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [roles, setRoles] = useState<Record<string, number>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    const [o, d, t, m] = await Promise.all([
      supabase.from('tt_organizations').select('*').eq('id', orgId).maybeSingle(),
      supabase.from('tt_departments').select('id, name, created_at').eq('org_id', orgId).order('name'),
      supabase.from('tt_teams').select('id, department_id').eq('org_id', orgId),
      supabase.from('tt_org_members').select('role').eq('org_id', orgId).eq('active', true),
    ]);
    setOrg(o.data ?? { name: membership!.org_name, time_zone: membership!.time_zone });
    setDepts(d.data ?? []); setTeams(t.data ?? []);
    setRoles((m.data ?? []).reduce((acc: Record<string, number>, r: any) => ({ ...acc, [r.role]: (acc[r.role] ?? 0) + 1 }), {}));
  }, [orgId, membership]);
  useEffect(() => { load(); }, [load]);

  const done = (error: { message: string } | null, ok: string) => { setMsg(error ? { kind: 'error', text: error.message } : { kind: 'ok', text: ok }); if (!error) load(); };
  const log = (action: string, detail: object = {}) => supabase.from('tt_activity_logs').insert({ org_id: orgId, entity_type: 'organization', entity_id: orgId, action, actor_id: uid, detail });

  async function saveOrg(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { error } = await supabase.from('tt_organizations').update({ name: String(f.get('name')).trim(), time_zone: f.get('tz') }).eq('id', orgId);
    if (!error) { await log('settings_updated'); refresh(); }
    done(error && { message: error.message.includes('time zone') ? 'That time zone isn’t recognized.' : error.message }, 'Organization updated.');
  }
  async function addDept(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget, name = String(new FormData(form).get('name')).trim();
    if (!name) return;
    const { error } = await supabase.from('tt_departments').insert({ org_id: orgId, name });
    if (!error) { form.reset(); await log('department_added', { name }); }
    done(error && { message: /duplicate|unique/i.test(error.message) ? 'That department already exists.' : error.message }, `Added ${name}.`);
  }
  async function renameDept(id: string, name: string) {
    const { error } = await supabase.from('tt_departments').update({ name: name.trim() }).eq('id', id);
    if (!error) { setRenaming(null); await log('department_renamed', { name }); }
    done(error, 'Department renamed.');
  }
  async function deleteDept(d: any) {
    const n = teams.filter((t) => t.department_id === d.id).length;
    if (!(await ask({ title: `Delete ${d.name}?`, message: `${n ? `Its ${n} team${n > 1 ? 's' : ''} will be kept without a department. ` : ''}Tasks in this department are kept too.`, confirmLabel: 'Delete department', danger: true })).ok) return;
    const { error } = await supabase.from('tt_departments').delete().eq('id', d.id);
    if (!error) await log('department_deleted', { name: d.name });
    done(error, `Deleted ${d.name}.`);
  }

  if (!org) return <PageSkeleton />;
  const total = Object.values(roles).reduce((a, b) => a + b, 0);

  return (
    <div className="pf">
      <div className="page-head">
        <div><h2 className="page-title">Organization settings</h2><p className="page-sub">{canEdit ? 'Manage how your organization is set up.' : 'How your organization is set up. Only owners and admins can change these settings.'}</p></div>
      </div>
      {msg && <p key={msg.text} role={msg.kind === 'error' ? 'alert' : 'status'} className={`auth-msg ${msg.kind}`}>{msg.kind === 'error' ? <X size={17} aria-hidden="true" /> : <Check size={17} aria-hidden="true" />}<span>{msg.text}</span></p>}

      <div className="pf-grid">
        <section className="card" aria-labelledby="org-h">
          <h3 id="org-h"><Building2 size={16} aria-hidden="true" /> Organization {!canEdit && <span className="prio"><Lock size={12} aria-hidden="true" />View only</span>}</h3>
          <form className="pf-form" onSubmit={saveOrg}>
            <label className="pf-wide">Name<input name="name" defaultValue={org.name} required maxLength={120} disabled={!canEdit} /></label>
            <label className="pf-wide">Time zone
              <select name="tz" defaultValue={org.time_zone} disabled={!canEdit}>{(ZONES.includes(org.time_zone) ? ZONES : [org.time_zone, ...ZONES]).map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}</select>
            </label>
            <p className="muted pf-wide tpl-note"><Globe2 size={14} aria-hidden="true" /> Reminders, recurring tasks and “due today” use this time zone.{org.created_at && ` Created ${fmt(org.created_at)}.`}</p>
            {canEdit && <div className="pf-wide pf-actions"><button type="submit">Save changes</button></div>}
          </form>
        </section>

        <div className="pf-col">
          <section className="card" aria-labelledby="you-h">
            <h3 id="you-h"><ShieldCheck size={16} aria-hidden="true" /> Your access</h3>
            <p><span className="prio prio-low">{label(role)}</span></p>
            <p className="muted">{ROLE_TEXT[role as keyof typeof ROLE_TEXT]?.blurb}</p>
          </section>
          <section className="card" aria-labelledby="ppl-h">
            <div className="panel-head"><h3 id="ppl-h"><Users size={16} aria-hidden="true" /> People</h3>{can(role, 'members:manage') && <Link to="/employees" className="mini-link">Manage people</Link>}</div>
            <ul className="role-counts">{ROLES.map((r) => <li key={r}><b>{roles[r] ?? 0}</b><small>{label(r)}{(roles[r] ?? 0) === 1 ? '' : 's'}</small></li>)}</ul>
            <p className="muted pf-hint">{total} active member{total === 1 ? '' : 's'}.</p>
          </section>
        </div>

        <section className="card" aria-labelledby="dep-h">
          <div className="panel-head"><h3 id="dep-h"><Layers size={16} aria-hidden="true" /> Departments</h3><small className="muted">{depts.length}</small></div>
          {depts.length === 0 ? <p className="muted">No departments yet.{canEdit && ' Add one below; templates and tasks can then be filed under it.'}</p> : (
            <ul className="people">{depts.map((d) => (
              <li key={d.id}>
                {renaming === d.id ? (
                  <form className="inline-add grow" onSubmit={(e) => { e.preventDefault(); renameDept(d.id, String(new FormData(e.currentTarget).get('n'))); }}>
                    <input name="n" defaultValue={d.name} aria-label={`Rename ${d.name}`} required maxLength={120} autoFocus />
                    <button type="submit">Save</button><button type="button" className="link" onClick={() => setRenaming(null)}>Cancel</button>
                  </form>
                ) : (<>
                  <span className="grow">{d.name}</span>
                  <small className="muted">{teams.filter((t) => t.department_id === d.id).length} teams</small>
                  {canEdit && <>
                    <button type="button" className="icon-btn sm" aria-label={`Rename ${d.name}`} onClick={() => setRenaming(d.id)}><Pencil size={14} aria-hidden="true" /></button>
                    <button type="button" className="icon-btn sm danger-text" aria-label={`Delete ${d.name}`} onClick={() => deleteDept(d)}><Trash2 size={14} aria-hidden="true" /></button>
                  </>}
                </>)}
              </li>))}</ul>)}
          {canEdit && <form className="inline-add" onSubmit={addDept}><input name="name" aria-label="New department" placeholder="New department, e.g. Finance" maxLength={120} /><button type="submit"><Plus size={15} aria-hidden="true" />Add</button></form>}
        </section>

        <section className="card" aria-labelledby="orgs-h">
          <div className="panel-head"><h3 id="orgs-h"><ArrowRightLeft size={16} aria-hidden="true" /> Your organizations</h3><button type="button" className="pill-btn ghost" onClick={() => navigate('/organizations/new')}><Plus size={15} aria-hidden="true" />New</button></div>
          <ul className="people">{memberships.map((m) => (
            <li key={m.org_id}>
              <span className="grow"><b>{m.org_name}</b><br /><small className="muted">{label(m.role)}</small></span>
              {m.org_id === orgId ? <span className="prio prio-low"><Check size={12} aria-hidden="true" />Current</span>
                : <button type="button" className="pill-btn ghost" onClick={() => switchOrg(m.org_id)}>Switch</button>}
            </li>))}</ul>
        </section>
      </div>
    </div>
  );
}
