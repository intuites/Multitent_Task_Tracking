import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Building2, Check, CopyPlus, Database, Globe2, Layers, LifeBuoy, Lock, Mail, Pencil, Plus, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { fmt, label, usePeople } from '../lib/ui';
import { ROLE_TEXT } from '../lib/roles';
import { ask } from '../components/Dialog';
import { PageSkeleton } from '../components/Skeleton';
import { Departments, type Msg } from './Employees';

const ROLES = ['admin', 'manager', 'employee'] as const;
// every IANA zone the browser knows; falls back to a short US-first list on old browsers
const ZONES: string[] = (() => {
  try { return (Intl as any).supportedValuesOf('timeZone'); } catch { return ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'UTC', 'Europe/London', 'Asia/Kolkata']; }
})();
const zoneList = (tz: string) => (ZONES.includes(tz) ? ZONES : [tz, ...ZONES]);
type View = 'hub' | 'orgs' | 'depts';

export default function OrgSettings() {
  const { membership, session, refresh } = useAuth();
  const orgId = membership!.org_id, role = membership!.role, uid = session!.user.id;
  const canEdit = can(role, 'org:manage');
  const [params, setParams] = useSearchParams();
  const view = (canEdit ? params.get('manage') : null) as View | null;
  const open = (v: View | null) => setParams(v ? { manage: v } : {});
  const [org, setOrg] = useState<any>(null);
  const [roles, setRoles] = useState<Record<string, number>>({});
  const { active: people } = usePeople(orgId);
  const admins = people.filter((p) => p.role === 'admin');
  const [msg, setMsg] = useState<Msg>(null);

  const load = useCallback(async () => {
    const [o, m] = await Promise.all([
      supabase.from('tt_organizations').select('*').eq('id', orgId).maybeSingle(),
      supabase.from('tt_org_members').select('role').eq('org_id', orgId).eq('active', true),
    ]);
    setOrg(o.data ?? { name: membership!.org_name, time_zone: membership!.time_zone });
    setRoles((m.data ?? []).reduce((acc: Record<string, number>, r: any) => ({ ...acc, [r.role]: (acc[r.role] ?? 0) + 1 }), {}));
  }, [orgId, membership]);
  useEffect(() => { load(); }, [load]);

  async function saveOrg(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { error } = await supabase.from('tt_organizations').update({ name: String(f.get('name')).trim(), time_zone: f.get('tz') }).eq('id', orgId);
    if (!error) { await supabase.from('tt_activity_logs').insert({ org_id: orgId, entity_type: 'organization', entity_id: orgId, action: 'settings_updated', actor_id: uid, detail: {} }); refresh(); load(); }
    setMsg(error ? { kind: 'error', text: error.message.includes('time zone') ? 'That time zone isn’t recognized.' : error.message } : { kind: 'ok', text: 'Organization updated.' });
  }

  if (!org) return <PageSkeleton />;
  const total = ROLES.reduce((n, r) => n + (roles[r] ?? 0), 0);
  const TILES = [
    { name: 'Manage users', hint: 'Invite people, change roles', icon: Users, to: '/employees' },
    { name: 'Manage organizations', hint: 'The organizations you created', icon: Building2, view: 'orgs' as View },
    { name: 'Manage departments', hint: 'Departments and their members', icon: Layers, view: 'depts' as View },
    { name: 'Manage templates', hint: 'Reusable task setups', icon: CopyPlus, to: '/templates' },
  ];

  return (
    <div className="pf">
      <div className="page-head">
        <div>
          <h2 className="page-title">{view === 'orgs' ? 'Manage organizations' : view === 'depts' ? 'Manage departments' : view ? 'Manage data' : 'Organization settings'}</h2>
          <p className="page-sub">{view ? 'Everything an admin looks after, in one place.' : canEdit ? 'Manage how your organization is set up.' : 'How your organization is set up. Only admins can change these settings.'}</p>
        </div>
        {canEdit && <div className="page-actions">
          {view ? <button type="button" className="pill-btn ghost" onClick={() => open(view === 'hub' ? null : 'hub')}><ArrowLeft size={16} aria-hidden="true" />{view === 'hub' ? 'Back to settings' : 'Manage data'}</button>
            : <button type="button" className="pill-btn" onClick={() => open('hub')}><Database size={16} aria-hidden="true" />Manage data</button>}
        </div>}
      </div>
      {msg && <p key={msg.text} role={msg.kind === 'error' ? 'alert' : 'status'} className={`auth-msg ${msg.kind}`}>{msg.kind === 'error' ? <X size={17} aria-hidden="true" /> : <Check size={17} aria-hidden="true" />}<span>{msg.text}</span></p>}

      {view && (
        <nav className="md-tiles" aria-label="Manage data">
          {TILES.map((t, i) => {
            const body = <><span className="md-ico"><t.icon size={20} aria-hidden="true" /></span><b>{t.name}</b><small>{t.hint}</small></>;
            return t.to
              ? <Link key={t.name} to={t.to} className="md-tile" style={{ '--i': i } as React.CSSProperties}>{body}</Link>
              : <button key={t.name} type="button" className={`md-tile ${view === t.view ? 'on' : ''}`} aria-pressed={view === t.view} style={{ '--i': i } as React.CSSProperties} onClick={() => open(t.view!)}>{body}</button>;
          })}
        </nav>
      )}

      {view === 'orgs' && <ManageOrgs say={setMsg} />}
      {view === 'depts' && <Departments say={setMsg} />}

      {!view && (
        <div className="pf-grid">
          <section className="card" aria-labelledby="org-h">
            <h3 id="org-h"><Building2 size={16} aria-hidden="true" /> Organization {!canEdit && <span className="prio"><Lock size={12} aria-hidden="true" />View only</span>}</h3>
            <form className="pf-form" onSubmit={saveOrg}>
              <label className="pf-wide">Name<input name="name" defaultValue={org.name} required maxLength={120} disabled={!canEdit} /></label>
              <label className="pf-wide">Time zone
                <select name="tz" defaultValue={org.time_zone} disabled={!canEdit}>{zoneList(org.time_zone).map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}</select>
              </label>
              <p className="muted pf-wide tpl-note"><Globe2 size={14} aria-hidden="true" /> Reminders, recurring tasks and “due today” use this time zone.{org.created_at && ` Created ${fmt(org.created_at)}.`}</p>
              {canEdit && <div className="pf-wide pf-actions"><button type="submit">Save changes</button></div>}
            </form>
          </section>

          <div className="pf-col">
            <section className="card" aria-labelledby="you-h">
              <h3 id="you-h"><ShieldCheck size={16} aria-hidden="true" /> Your access</h3>
              <p><span className="prio prio-low">{membership!.platform ? 'Platform admin' : label(role)}</span></p>
              <p className="muted">{membership!.platform ? 'You look after every organization on Taskify.' : ROLE_TEXT[role as keyof typeof ROLE_TEXT]?.blurb}</p>
            </section>
            <section className="card" aria-labelledby="ppl-h">
              <div className="panel-head"><h3 id="ppl-h"><Users size={16} aria-hidden="true" /> People</h3>{can(role, 'members:manage') && <Link to="/employees" className="mini-link">Manage people</Link>}</div>
              <ul className="role-counts">{ROLES.map((r) => <li key={r}><b>{roles[r] ?? 0}</b><small>{label(r)}{(roles[r] ?? 0) === 1 ? '' : 's'}</small></li>)}</ul>
              <p className="muted pf-hint">{total} active member{total === 1 ? '' : 's'}.</p>
            </section>
            {admins.length > 0 && <section className="card" aria-labelledby="help-h">
              <h3 id="help-h"><LifeBuoy size={16} aria-hidden="true" /> Need help?</h3>
              <p className="muted">For access, data or organization problems, contact an admin.</p>
              <ul className="help-list">{admins.map((p) => <li key={p.id}><span className="grow"><b>{p.name}</b><small className="muted">{label(p.role)}</small></span>
                {p.email && <a className="mini-link" href={`mailto:${p.email}?subject=${encodeURIComponent(`Taskify help: ${membership!.org_name}`)}`}><Mail size={14} aria-hidden="true" />Email</a>}</li>)}</ul>
            </section>}
          </div>
        </div>
      )}
    </div>
  );
}

/** The organizations this person created: open, rename, change time zone, delete. */
function ManageOrgs({ say }: { say: (m: Msg) => void }) {
  const { memberships, membership, session, switchOrg, refresh } = useAuth();
  const navigate = useNavigate();
  const uid = session!.user.id;
  const [orgs, setOrgs] = useState<any[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [legacy, setLegacy] = useState(false);

  const load = useCallback(async () => {
    const ids = memberships.filter((m) => can(m.role, 'org:manage')).map((m) => m.org_id);
    const { data, error } = await supabase.from('tt_organizations').select('*').in('id', ids).order('created_at');
    if (error) { say({ kind: 'error', text: error.message }); setOrgs([]); return; }
    // before migration 0020 there is no created_by; fall back to every organization you administer
    const noCol = (data ?? []).some((o) => !('created_by' in o));
    setLegacy(noCol);
    setOrgs(noCol ? data ?? [] : (data ?? []).filter((o) => o.created_by === uid));
  }, [memberships, uid, say]);
  useEffect(() => { load(); }, [load]);

  async function save(e: FormEvent<HTMLFormElement>, o: any) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { error } = await supabase.from('tt_organizations').update({ name: String(f.get('name')).trim(), time_zone: f.get('tz') }).eq('id', o.id);
    if (error) return say({ kind: 'error', text: error.message });
    setEditing(null); say({ kind: 'ok', text: 'Organization updated.' }); refresh(); load();
  }
  async function remove(o: any) {
    if (!(await ask({ title: `Delete ${o.name}?`, message: 'This permanently deletes the organization with all its members’ access, departments, tasks, comments and files. It can’t be undone.', confirmLabel: 'Delete organization', danger: true })).ok) return;
    const { data, error } = await supabase.from('tt_organizations').delete().eq('id', o.id).select('id');
    if (error || !data?.length) return say({ kind: 'error', text: error?.message ?? 'Only the person who created an organization can delete it (needs database update 0020).' });
    say({ kind: 'ok', text: `Deleted ${o.name}.` });
    const next = memberships.find((m) => m.org_id !== o.id);
    if (o.id === membership!.org_id && next) switchOrg(next.org_id);
    refresh(); load();
  }

  return (
    <section className="card" aria-labelledby="mo-h">
      <div className="panel-head"><h3 id="mo-h"><Building2 size={16} aria-hidden="true" /> {legacy ? 'Organizations you administer' : 'Organizations you created'}</h3>
        <button type="button" className="pill-btn ghost" onClick={() => navigate('/organizations/new')}><Plus size={15} aria-hidden="true" />New organization</button></div>
      {orgs === null ? <PageSkeleton /> : orgs.length === 0 ? <p className="muted">You haven’t created an organization yet.</p> : (
        <ul className="mo-list">{orgs.map((o) => (
          <li key={o.id}>
            {editing === o.id ? (
              <form className="mo-edit" onSubmit={(e) => save(e, o)}>
                <label>Name<input name="name" defaultValue={o.name} required maxLength={120} autoFocus /></label>
                <label>Time zone<select name="tz" defaultValue={o.time_zone}>{zoneList(o.time_zone).map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}</select></label>
                <span className="mo-actions"><button type="submit"><Check size={15} aria-hidden="true" />Save</button><button type="button" className="link" onClick={() => setEditing(null)}>Cancel</button></span>
              </form>
            ) : (<>
              <span className="md-ico sm"><Building2 size={16} aria-hidden="true" /></span>
              <span className="grow"><b>{o.name}</b>{o.id === membership!.org_id && <small className="prio prio-low">Current</small>}<br /><small className="muted">{o.time_zone.replace(/_/g, ' ')} · created {fmt(o.created_at)}</small></span>
              <span className="row-actions">
                {o.id !== membership!.org_id && <button type="button" className="pill-btn ghost sm" onClick={() => switchOrg(o.id)}>Open</button>}
                <button type="button" className="icon-btn sm" aria-label={`Edit ${o.name}`} onClick={() => setEditing(o.id)}><Pencil size={14} aria-hidden="true" /></button>
                {!legacy && <button type="button" className="icon-btn sm danger-text" aria-label={`Delete ${o.name}`} onClick={() => remove(o)}><Trash2 size={14} aria-hidden="true" /></button>}
              </span>
            </>)}
          </li>))}</ul>)}
    </section>
  );
}
