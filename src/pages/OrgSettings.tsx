import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Building2, Check, CopyPlus, Database, Globe2, Layers, LifeBuoy, Lock, Mail, Palette, Pencil, Plus, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { fmt, label, usePeople, zoneList } from '../lib/ui';
import { ROLE_TEXT } from '../lib/roles';
import { applyBrand } from '../lib/theme';
import { brandPalette, contrast } from '../lib/palette';
import { FAMILIES, QUICK, TRENDING } from '../lib/brandColors';
import { ask } from '../components/Dialog';
import { PageSkeleton } from '../components/Skeleton';
import { Departments, type Msg } from './Employees';

const ROLES = ['admin', 'employee'] as const;
const MORE_COUNT = FAMILIES.reduce((n, f) => n + f.colors.length, 0) + TRENDING.length;
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
  // brand color being picked: previewed live across the app, saved with the form, undone if you leave without saving
  const [brand, setBrand] = useState<string | null>(membership!.brand_color ?? null);
  useEffect(() => { applyBrand(brand, false); }, [brand]);
  const [edited, setDirty] = useState(false); // name or time zone typed in
  const saved = membership!.brand_color;
  useEffect(() => () => applyBrand(saved, false), [saved]);

  const load = useCallback(async () => {
    const [o, m] = await Promise.all([
      supabase.from('tt_organizations').select('*').eq('id', orgId).maybeSingle(),
      supabase.from('tt_org_members').select('role').eq('org_id', orgId).eq('active', true),
    ]);
    setOrg(o.data ?? { name: membership!.org_name, time_zone: membership!.time_zone });
    setBrand(o.data?.brand_color ?? null);
    setRoles((m.data ?? []).reduce((acc: Record<string, number>, r: any) => ({ ...acc, [r.role]: (acc[r.role] ?? 0) + 1 }), {}));
  }, [orgId, membership]);
  useEffect(() => { load(); }, [load]);

  async function saveOrg(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { error } = await supabase.from('tt_organizations').update({ name: String(f.get('name')).trim(), time_zone: f.get('tz'), brand_color: brand }).eq('id', orgId);
    if (!error) { setDirty(false); await supabase.from('tt_activity_logs').insert({ org_id: orgId, entity_type: 'organization', entity_id: orgId, action: 'settings_updated', actor_id: uid, detail: {} }); refresh(); load(); }
    setMsg(error ? { kind: 'error', text: error.message.includes('time zone') ? 'That time zone isn’t recognized.' : error.message.includes('brand_color') ? 'Brand colors need database update 0029. Run it in Supabase, then try again.' : error.message } : { kind: 'ok', text: 'Organization updated.' });
  }

  if (!org) return <PageSkeleton />;
  const total = ROLES.reduce((n, r) => n + (roles[r] ?? 0), 0);
  const dirty = edited || brand !== (org.brand_color ?? null);
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
        <div className="os">
          <section className="card os-hero" aria-labelledby="org-h">
            <span className="os-mark" aria-hidden="true">{org.name.trim().charAt(0).toUpperCase()}</span>
            <div className="os-id">
              <h3 id="org-h">{org.name}</h3>
              <p className="os-facts">
                <span><Globe2 size={14} aria-hidden="true" />{org.time_zone.replace(/_/g, ' ')}</span>
                {org.created_at && <span>Created {fmt(org.created_at)}</span>}
                {!canEdit && <span className="prio"><Lock size={12} aria-hidden="true" />View only</span>}
              </p>
            </div>
            <ul className="os-stats" aria-label="People">
              {ROLES.map((r) => <li key={r}><b>{roles[r] ?? 0}</b><small>{label(r)}{(roles[r] ?? 0) === 1 ? '' : 's'}</small></li>)}
              <li><b>{total}</b><small>Active</small></li>
            </ul>
            {can(role, 'members:manage') && <Link to="/employees" className="pill-btn ghost os-people"><Users size={15} aria-hidden="true" />Manage people</Link>}
          </section>

          <form className="os-main" onSubmit={saveOrg} onChange={() => setDirty(true)}>
            <section className="card os-sec" aria-labelledby="det-h">
              <header><h3 id="det-h"><Building2 size={16} aria-hidden="true" /> Details</h3><p className="muted">The name everyone sees, and the clock reminders run on.</p></header>
              <div className="os-fields">
                <label>Name<input name="name" defaultValue={org.name} required maxLength={120} disabled={!canEdit} /></label>
                <label>Time zone
                  <select name="tz" defaultValue={org.time_zone} disabled={!canEdit}>{zoneList(org.time_zone).map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}</select>
                </label>
              </div>
              <p className="muted tpl-note"><Globe2 size={14} aria-hidden="true" /> Reminders, recurring tasks and “due today” use this time zone.</p>
            </section>

            <section className="card os-sec" aria-labelledby="brand-h">
              <header><h3 id="brand-h"><Palette size={16} aria-hidden="true" /> Brand color</h3><p className="muted">Everyone in {org.name} sees this color, in light and dark mode. The whole app previews it as you pick.</p></header>
              <div className="os-brand">
              <fieldset className="brand-pick" disabled={!canEdit}>
                <legend className="sr-only">Brand color</legend>
                <p className="os-current"><span style={{ '--sw': brand ?? '#2e7d4f' } as React.CSSProperties} aria-hidden="true" /><b>{colorName(brand)}</b><small className="muted">{(brand ?? '#2e7d4f').toUpperCase()}</small></p>
                <div className="brand-swatches">
                  {QUICK.map(([name, hex]) => <Swatch key={name} name={name} hex={hex} brand={brand} pick={setBrand} />)}
                  <label className="brand-custom" title="Pick any color">
                    <input type="color" value={brand ?? '#2e7d4f'} onChange={(e) => setBrand(e.target.value)} aria-label="Custom brand color" />
                    Custom
                  </label>
                </div>
                <details className="brand-more">
                  <summary>More colors ({MORE_COUNT})</summary>
                  <div className="brand-fams">
                    {FAMILIES.map((f) => (
                      <div key={f.family} className="brand-fam" role="group" aria-label={f.family}>
                        <small>{f.family}</small>
                        <span>{f.colors.map((c) => <Swatch key={c.hex} name={c.name} hex={c.hex} brand={brand} pick={setBrand} small />)}</span>
                      </div>))}
                    <div className="brand-fam trending" role="group" aria-label="Colors of the year">
                      <small>Colors of the year</small>
                      <span>{TRENDING.map((c) => <Swatch key={c.hex} name={c.name} hex={c.hex} brand={brand} pick={setBrand} small />)}</span>
                    </div>
                  </div>
                </details>
              </fieldset>
                <div className="brand-preview os-preview" aria-label="Preview of the brand color" role="img">
                  {(['light', 'dark'] as const).map((m) => {
                    const p = brandPalette(brand ?? '#2e7d4f', m);
                    const vars = { '--b': p['--brand'], '--tint': p['--brand-tint'], '--grad': p['--brand-grad'], '--ink': p['--brand-ink'],
                      '--bp-bg': p['--panel'], '--bp-fg': p['--text'], '--bp-muted': p['--muted'], '--bp-line': p['--line'] } as React.CSSProperties;
                    return (
                    <div key={m} className="bp" style={vars} aria-hidden="true">
                      <small className="bp-mode">{m === 'light' ? 'Light mode' : 'Dark mode'}</small>
                      <span className="bp-nav">Dashboard</span>
                      <span className="bp-kpi"><small>My open tasks</small><b>4</b></span>
                      <span className="bp-row"><span className="bp-btn">Update status</span><span className="bp-link">View all</span></span>
                      <span className="bp-bar"><i /></span>
                    </div>);
                  })}
                </div>
              </div>
            </section>

            {canEdit && <div className={`os-save${dirty ? ' on' : ''}`}>
              <span className={dirty ? 'os-dirty' : 'muted'}>{dirty ? 'You have unsaved changes.' : 'All changes saved.'}</span>
              {dirty && <button type="button" className="link" onClick={(e) => { e.currentTarget.form!.reset(); setBrand(org.brand_color ?? null); setDirty(false); }}>Discard</button>}
              <button type="submit" disabled={!dirty}>Save changes</button>
            </div>}
          </form>

          <aside className="os-side">
            <section className="card" aria-labelledby="you-h">
              <h3 id="you-h"><ShieldCheck size={16} aria-hidden="true" /> Your access</h3>
              <p><span className="prio prio-low">{membership!.platform ? 'Platform admin' : label(role)}</span></p>
              <p className="muted">{membership!.platform ? 'You look after every organization on Taskify.' : ROLE_TEXT[role as keyof typeof ROLE_TEXT]?.blurb}</p>
            </section>
            {admins.length > 0 && <section className="card" aria-labelledby="help-h">
              <h3 id="help-h"><LifeBuoy size={16} aria-hidden="true" /> Need help?</h3>
              <p className="muted">For access, data or organization problems, contact an admin.</p>
              <ul className="help-list">{admins.map((p) => <li key={p.id}><span className="grow"><b>{p.name}</b><small className="muted">{label(p.role)}</small></span>
                {p.email && <a className="mini-link" href={`mailto:${p.email}?subject=${encodeURIComponent(`Taskify help: ${membership!.org_name}`)}`}><Mail size={14} aria-hidden="true" />Email</a>}</li>)}</ul>
            </section>}
          </aside>
        </div>
      )}
    </div>
  );
}

const NAMES = new Map<string | null, string>([...FAMILIES.flatMap((f) => f.colors.map((c) => [c.hex, c.name] as const)), ...TRENDING.map((t) => [t.hex, t.name] as const), ...QUICK.map(([n, h]) => [h, n] as const)]);
const colorName = (hex: string | null) => NAMES.get(hex) ?? 'Custom color';

/** One brand color choice; the check mark takes whichever of white/dark reads on it. */
function Swatch({ name, hex, brand, pick, small }: { name: string; hex: string | null; brand: string | null; pick: (h: string | null) => void; small?: boolean }) {
  const fill = hex ?? '#2e7d4f';
  const on = (brand ?? null) === hex;
  const ink = contrast(fill, '#ffffff') >= contrast(fill, '#111214') ? '#ffffff' : '#111214';
  return <button type="button" className={`brand-swatch${small ? ' sm' : ''}`} style={{ '--sw': fill, color: ink } as React.CSSProperties}
    aria-pressed={on} aria-label={name} title={name} onClick={() => pick(hex)}>{on && <Check size={small ? 13 : 15} aria-hidden="true" />}</button>;
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
    // platform admins manage every organization
    setOrgs(noCol || membership!.platform ? data ?? [] : (data ?? []).filter((o) => o.created_by === uid));
  }, [memberships, membership, uid, say]);
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
      <div className="panel-head"><h3 id="mo-h"><Building2 size={16} aria-hidden="true" /> {membership!.platform ? 'All organizations' : legacy ? 'Organizations you administer' : 'Organizations you created'}</h3>
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
