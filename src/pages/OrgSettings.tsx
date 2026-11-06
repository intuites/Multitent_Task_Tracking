import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Building2, Check, Clock, CopyPlus, Database, Download, Globe2, KeyRound, Layers, LifeBuoy, Lock, Mail, Palette, Pencil, Plus, ShieldCheck, Sun, Sunset, Trash2, Users, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { fmt, label, usePeople, zoneList } from '../lib/ui';
import { ROLE_TEXT } from '../lib/roles';
import { applyBrand, applyFont, applyTextSize, loadJakarta, restoreLook, FONT_FAMILIES, FONT_STYLES, TEXT_SIZES, type FontFamily, type FontStyle, type TextSize } from '../lib/theme';
import ExportMenu, { type ExportFormat } from '../components/ExportMenu';
import { TwoFactorForm } from './TwoFactor';
import { brandPalette, contrast } from '../lib/palette';
import { FAMILIES, QUICK, TRENDING } from '../lib/brandColors';
import { ask } from '../components/Dialog';
import { PageSkeleton } from '../components/Skeleton';
import { Departments, type Msg } from './Employees';

const ROLES = ['admin', 'employee'] as const;
type Tab = 'general' | 'digest' | 'look' | 'access' | 'data' | 'danger';
const SECTIONS: { id: Tab; name: string; hint: string; icon: typeof Building2 }[] = [
  { id: 'general', name: 'General', hint: 'Name and time zone', icon: Building2 },
  { id: 'digest', name: 'Digest emails', hint: 'Daily summaries', icon: Mail },
  { id: 'look', name: 'Appearance', hint: 'Default color, font, text size', icon: Palette },
  { id: 'access', name: 'Access & security', hint: 'Roles, two-factor, help', icon: ShieldCheck },
  { id: 'data', name: 'Data & export', hint: 'Everything as Excel or PDF', icon: Download },
  { id: 'danger', name: 'Danger zone', hint: 'Delete this organization', icon: AlertTriangle },
];
const SIZE_TEXT: Record<TextSize, string> = { compact: 'Compact', normal: 'Normal', large: 'Large' };
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
  // Data is for admins; Danger zone for whoever created the organization (and platform admins), as the database allows
  const mayDelete = !!org && (org.created_by === uid || !!membership!.platform);
  const sections = SECTIONS.filter((s) => (s.id === 'data' ? canEdit : s.id === 'danger' ? mayDelete : true));
  const tab: Tab = sections.some((s) => s.id === params.get('tab')) ? params.get('tab') as Tab : 'general';
  const setTab = (t: Tab) => setParams(t === 'general' ? {} : { tab: t }, { replace: true });
  const [roles, setRoles] = useState<Record<string, number>>({});
  const { active: people } = usePeople(orgId);
  const admins = people.filter((p) => p.role === 'admin');
  const [msg, setMsg] = useState<Msg>(null);
  // brand color being picked: previewed live across the app, saved with the form, undone if you leave without saving
  const [brand, setBrand] = useState<string | null>(membership!.brand_color ?? null);
  // previews skip the first render, so opening this page doesn't cover your own look with the organization's
  const touched = useRef({ brand: false, font: false, size: false });
  useEffect(() => { if (touched.current.brand) applyBrand(brand, false); touched.current.brand = true; }, [brand]);
  const [edited, setDirty] = useState(false); // name or time zone typed in
  const [dg, setDg] = useState<Dg>(dgOf({}));
  const [tz, setTz] = useState(membership!.time_zone ?? 'America/New_York');
  // font family and style, and text size: previewed live like the brand color
  const [font, setFont] = useState<Font>(fontOf(membership));
  useEffect(() => { if (touched.current.font) applyFont(font.family, font.style, false); touched.current.font = true; }, [font]);
  const [size, setSize] = useState<TextSize | null>((membership!.text_size as TextSize) ?? null);
  useEffect(() => { if (touched.current.size) applyTextSize(size, false); touched.current.size = true; }, [size]);
  const [mfa, setMfa] = useState(!!membership!.require_admin_mfa);
  // leaving: back to the saved look (each person's own choices over the organization's)
  useEffect(() => () => restoreLook(), []);

  const load = useCallback(async () => {
    const [o, m] = await Promise.all([
      supabase.from('tt_organizations').select('*').eq('id', orgId).maybeSingle(),
      supabase.from('tt_org_members').select('role').eq('org_id', orgId).eq('active', true),
    ]);
    setOrg(o.data ?? { name: membership!.org_name, time_zone: membership!.time_zone });
    setBrand(o.data?.brand_color ?? null); setFont(fontOf(o.data ?? {}));
    setDg(dgOf(o.data ?? {})); setTz(o.data?.time_zone ?? membership!.time_zone);
    setSize(o.data?.text_size ?? null); setMfa(o.data?.require_admin_mfa === true);
    setRoles((m.data ?? []).reduce((acc: Record<string, number>, r: any) => ({ ...acc, [r.role]: (acc[r.role] ?? 0) + 1 }), {}));
  }, [orgId, membership]);
  useEffect(() => { load(); }, [load]);

  async function saveOrg(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const extra = dg.extra.split(/[\s,;]+/).filter(Boolean);
    const bad = extra.find((x) => !EMAIL.test(x));
    // a digest problem: open that section so the field is in view
    if (bad) { setTab('digest'); return setMsg({ kind: 'error', text: `“${bad}” isn’t a valid email address.` }); }
    if (extra.length > 20) { setTab('digest'); return setMsg({ kind: 'error', text: 'Add at most 20 extra digest addresses.' }); }
    if (dg.midOn && dg.eodOn && dg.mid >= dg.eod) { setTab('digest'); return setMsg({ kind: 'error', text: 'The midday digest has to go out before the end-of-day digest.' }); }
    // only once migration 0032 has added the columns
    const digest = 'digest_midday' in org ? { digest_midday_on: dg.midOn, digest_midday: dg.mid, digest_eod_on: dg.eodOn, digest_eod: dg.eod,
      digest_days: dg.days, digest_leads: dg.leads, digest_extra_emails: extra } : {};
    // only once migration 0034 has added the columns; defaults are stored as null
    const fonts = 'font_family' in org ? { font_family: font.family === 'fabric' ? null : font.family, font_style: font.style === 'classic' ? null : font.style } : {};
    // only once migration 0036 has added the columns
    const more = 'text_size' in org ? { text_size: size === 'normal' ? null : size, require_admin_mfa: mfa } : {};
    const { error } = await supabase.from('tt_organizations').update({ name: String(f.get('name')).trim(), time_zone: f.get('tz'), brand_color: brand, ...digest, ...fonts, ...more }).eq('id', orgId);
    if (!error) { setDirty(false); await supabase.from('tt_activity_logs').insert({ org_id: orgId, entity_type: 'organization', entity_id: orgId, action: 'settings_updated', actor_id: uid, detail: {} }); refresh(); load(); }
    setMsg(error ? { kind: 'error', text: error.message.includes('time zone') ? 'That time zone isn’t recognized.' : error.message.includes('brand_color') ? 'Brand colors need database update 0029. Run it in Supabase, then try again.' : error.message } : { kind: 'ok', text: 'Organization updated.' });
    if (error && /two-factor/i.test(error.message)) setTab('access');
  }

  if (!org) return <PageSkeleton />;
  const total = ROLES.reduce((n, r) => n + (roles[r] ?? 0), 0);
  const dirty = edited || brand !== (org.brand_color ?? null) || JSON.stringify(dg) !== JSON.stringify(dgOf(org)) || JSON.stringify(font) !== JSON.stringify(fontOf(org))
    || (size ?? 'normal') !== (org.text_size ?? 'normal') || mfa !== (org.require_admin_mfa === true);
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

          <nav className="os-nav" aria-label="Settings sections">
            {sections.map((s) => (
              <button key={s.id} type="button" className="os-tab" aria-current={tab === s.id ? 'page' : undefined} onClick={() => setTab(s.id)}>
                <s.icon size={18} aria-hidden="true" /><span><b>{s.name}</b><small>{s.hint}</small></span>
              </button>))}
          </nav>

          <form className="os-main" onSubmit={saveOrg} onChange={() => setDirty(true)}>
            {/* every section stays mounted (hidden when not shown) so one Save covers all of them */}
            <div hidden={tab !== 'general'} className="os-pane">
            <section className="card os-sec" aria-labelledby="det-h">
              <header><h3 id="det-h"><Building2 size={16} aria-hidden="true" /> Details</h3><p className="muted">The name everyone sees, and the clock reminders run on.</p></header>
              <div className="os-fields">
                <label>Name<input name="name" defaultValue={org.name} required maxLength={120} disabled={!canEdit} /></label>
                <label>Time zone
                  <select name="tz" defaultValue={org.time_zone} disabled={!canEdit} onChange={(e) => setTz(e.target.value)}>{zoneList(org.time_zone).map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}</select>
                </label>
              </div>
              <p className="muted tpl-note"><Globe2 size={14} aria-hidden="true" /> Reminders, recurring tasks, digests and “due today” use this time zone.</p>
            </section>
            </div>

            <div hidden={tab !== 'digest'} className="os-pane">
              <DigestSettings dg={dg} set={(p) => setDg((d) => ({ ...d, ...p }))} tz={tz} canEdit={canEdit} ready={'digest_midday' in org} />
            </div>

            <div hidden={tab !== 'look'} className="os-pane">
            <section className="card os-sec" aria-labelledby="look-h">
              <header><h3 id="look-h"><Palette size={16} aria-hidden="true" /> Appearance</h3><p className="muted">The color and font everyone in {org.name} sees. The whole app previews your picks before you save.</p></header>
              <div className="os-brand">
              <div className="os-controls">
              <fieldset className="brand-pick" disabled={!canEdit}>
                <legend>Brand color</legend>
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
              <FontSettings font={font} set={(p) => setFont((v) => ({ ...v, ...p }))} canEdit={canEdit} ready={'font_family' in org} />
              <div className="ml-row"><span className="fp-label" id="os-size">Text size</span>
                <div className="seg ml-seg" role="group" aria-labelledby="os-size">
                  {TEXT_SIZES.map((s) => <button key={s} type="button" aria-pressed={(size ?? 'normal') === s} disabled={!canEdit || !('text_size' in org)} onClick={() => setSize(s)}>{SIZE_TEXT[s]}</button>)}
                </div>
                <small className="muted">{'text_size' in org ? 'The starting size for everyone.' : 'Run database update 0036 in Supabase to save a text size.'} Each person can still pick their own color, font and size in Profile → Appearance.</small></div>
              </div>
                <div className="brand-preview os-preview" aria-label="Preview of the color and font" role="img">
                  {(['light', 'dark'] as const).map((m) => {
                    const p = brandPalette(brand ?? '#2e7d4f', m);
                    const vars = { '--b': p['--brand'], '--tint': p['--brand-tint'], '--grad': p['--brand-grad'], '--ink': p['--brand-ink'],
                      '--bp-bg': p['--panel'], '--bp-fg': p['--text'], '--bp-muted': p['--muted'], '--bp-line': p['--line'] } as React.CSSProperties;
                    return (
                    <div key={m} className="bp" style={vars} aria-hidden="true">
                      <small className="bp-mode">{m === 'light' ? 'Light mode' : 'Dark mode'}</small>
                      <b className="bp-title">Quarterly planning</b>
                      <span className="bp-nav">Dashboard</span>
                      <span className="bp-kpi"><small>My open tasks</small><b>4</b></span>
                      <span className="bp-row"><span className="bp-btn">Update status</span><span className="bp-link">View all</span></span>
                      <span className="bp-bar"><i /></span>
                    </div>);
                  })}
                </div>
              </div>
            </section>
            </div>

            <div hidden={tab !== 'access'} className="os-pane os-access">
              <section className="card" aria-labelledby="you-h">
                <h3 id="you-h"><ShieldCheck size={16} aria-hidden="true" /> Your access</h3>
                <p><span className="prio prio-low">{membership!.platform ? 'Platform admin' : label(role)}</span></p>
                <p className="muted">{membership!.platform ? 'You look after every organization on Taskify.' : ROLE_TEXT[role as keyof typeof ROLE_TEXT]?.blurb}</p>
              </section>
              {canEdit && <TwoFactorSetting on={mfa} set={(v) => setMfa(v)} ready={'require_admin_mfa' in org} orgName={org.name} />}
              {admins.length > 0 && <section className="card" aria-labelledby="help-h">
                <h3 id="help-h"><LifeBuoy size={16} aria-hidden="true" /> Need help?</h3>
                <p className="muted">For access, data or organization problems, contact an admin.</p>
                <ul className="help-list">{admins.map((p) => <li key={p.id}><span className="grow"><b>{p.name}</b><small className="muted">{label(p.role)}</small></span>
                  {p.email && <a className="mini-link" href={`mailto:${p.email}?subject=${encodeURIComponent(`Taskify help: ${membership!.org_name}`)}`}><Mail size={14} aria-hidden="true" />Email</a>}</li>)}</ul>
              </section>}
            </div>

            {canEdit && <div hidden={tab !== 'data'} className="os-pane"><ExportData orgId={orgId} orgName={org.name} say={setMsg} /></div>}
            {mayDelete && <div hidden={tab !== 'danger'} className="os-pane"><DangerZone org={org} say={setMsg} /></div>}

            {canEdit && <div className={`os-save${dirty ? ' on' : ''}`} hidden={(tab === 'data' || tab === 'danger') && !dirty}>
              <span className={dirty ? 'os-dirty' : 'muted'}>{dirty ? 'You have unsaved changes.' : 'All changes saved.'}</span>
              {dirty && <button type="button" className="link" onClick={(e) => { e.currentTarget.form!.reset(); setBrand(org.brand_color ?? null); setFont(fontOf(org)); setSize(org.text_size ?? null); setMfa(org.require_admin_mfa === true); setDg(dgOf(org)); setTz(org.time_zone); setDirty(false); }}>Discard</button>}
              <button type="submit" disabled={!dirty}>Save changes</button>
            </div>}
          </form>
        </div>
      )}
    </div>
  );
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
type Dg = { midOn: boolean; mid: string; eodOn: boolean; eod: string; days: 'daily' | 'weekdays'; leads: boolean; extra: string };
/** Digest settings as saved (defaults before migration 0032 match what the email job uses). */
const dgOf = (o: any): Dg => ({
  midOn: o.digest_midday_on ?? true, mid: String(o.digest_midday ?? '13:30').slice(0, 5),
  eodOn: o.digest_eod_on ?? true, eod: String(o.digest_eod ?? '17:50').slice(0, 5),
  days: o.digest_days === 'weekdays' ? 'weekdays' : 'daily', leads: o.digest_leads ?? true, extra: (o.digest_extra_emails ?? []).join(', '),
});
const at12 = (hm: string) => { const [h, m] = hm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const zoneName = (z: string) => z.split('/').pop()!.replace(/_/g, ' ');
/** `hm` today in time zone `tz`, shown on the viewer's own clock ("12:00 AM"). */
function onMyClock(hm: string, tz: string) {
  const day = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const guess = Date.parse(`${day}T${hm}:00Z`);
  const seen = Date.parse(`${new Date(guess).toLocaleString('sv-SE', { timeZone: tz }).replace(' ', 'T')}Z`);
  return new Date(guess - (seen - guess)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Organization settings → Digest emails: two daily summaries of open work, each with its own time. */
function DigestSettings({ dg, set, tz, canEdit, ready }: { dg: Dg; set: (p: Partial<Dg>) => void; tz: string; canEdit: boolean; ready: boolean }) {
  const off = !canEdit || !ready;
  const mine = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const rows = [
    { key: 'mid' as const, on: dg.midOn, time: dg.mid, name: 'Midday digest', hint: 'What is still open halfway through the day.', icon: Sun },
    { key: 'eod' as const, on: dg.eodOn, time: dg.eod, name: 'End-of-day digest', hint: 'What is left before everyone signs off.', icon: Sunset },
  ];
  const live = rows.filter((r) => r.on);
  const when = live.map((r) => at12(r.time)).join(' and ');
  const sameClock = live.every((r) => onMyClock(r.time, tz) === at12(r.time));
  return (
    <section className="card os-sec" aria-labelledby="dg-h">
      <header><h3 id="dg-h"><Mail size={16} aria-hidden="true" /> Digest emails</h3>
        <p className="muted">A summary of open and overdue tasks, grouped by department, with a link to each task.</p></header>
      {!ready && <p className="muted tpl-note"><Lock size={14} aria-hidden="true" /> Run database update 0032 in Supabase to change these. Until then digests go out at 1:30 PM and 5:50 PM, every day.</p>}
      <ul className="dg-list">
        {rows.map((r) => (
          <li key={r.key} className={r.on ? 'on' : ''}>
            <span className="dg-ico"><r.icon size={18} aria-hidden="true" /></span>
            <span className="dg-name"><b>{r.name}</b><small className="muted">{r.hint}</small></span>
            <label className="dg-time"><span className="sr-only">{r.name} time</span>
              <input type="time" value={r.time} required disabled={off || !r.on} onChange={(e) => set({ [r.key]: e.target.value || r.time })} /></label>
            <button type="button" role="switch" aria-checked={r.on} aria-label={`${r.name} ${r.on ? 'on' : 'off'}`} disabled={off}
              className={r.on ? 'switch on' : 'switch'} onClick={() => set({ [`${r.key}On`]: !r.on } as Partial<Dg>)}><span /></button>
          </li>))}
      </ul>
      <div className="dg-opts">
        <div className="dg-field"><span id="dg-days">Send on</span>
          <div className="seg" role="group" aria-labelledby="dg-days">
            {([['daily', 'Every day'], ['weekdays', 'Monday to Friday']] as const).map(([v, l]) =>
              <button key={v} type="button" aria-pressed={dg.days === v} disabled={off} onClick={() => set({ days: v })}>{l}</button>)}
          </div></div>
        <div className="dg-field"><span id="dg-who">Who gets them</span>
          <p className="dg-who"><ShieldCheck size={15} aria-hidden="true" /> Admins: the whole organization</p>
          <label className="dg-check"><input type="checkbox" checked={dg.leads} disabled={off} onChange={(e) => set({ leads: e.target.checked })} />
            Leads and managers: only the tasks they lead or manage</label>
        </div>
      </div>
      <label className="dg-extra"><span>Also send to <small className="muted">(optional)</small></span>
        <input value={dg.extra} disabled={off} onChange={(e) => set({ extra: e.target.value })} placeholder="ops@company.com, director@company.com" />
        <small className="muted nt-help">Separate with commas. They get the whole-organization digest.</small></label>
      <p className="dg-summary" role="status">
        <Clock size={15} aria-hidden="true" />
        {live.length === 0 ? <span>Digests are off. Nobody gets a summary email.</span> : <span>
          <b>{live.length === 2 ? 'Two digests' : live[0].name}</b> at {when} {zoneName(tz)} time, {dg.days === 'daily' ? 'every day' : 'Monday to Friday'}.
          {!sameClock && <> That is {live.map((r) => onMyClock(r.time, tz)).join(' and ')} on your clock ({zoneName(mine)}).</>}
        </span>}
      </p>
    </section>
  );
}

type Font = { family: FontFamily; style: FontStyle };
/** Font choice as saved (null columns, or no columns before migration 0034, mean the defaults). */
const fontOf = (o: any): Font => ({
  family: FONT_FAMILIES.includes(o?.font_family) ? o.font_family : 'fabric',
  style: FONT_STYLES.includes(o?.font_style) ? o.font_style : 'classic',
});
const FAMILY_TEXT: Record<FontFamily, [string, string]> = {
  fabric: ['Fabric Grotesk', 'Modern and compact. The default.'],
  jakarta: ['Plus Jakarta Sans', 'Rounded and friendly.'],
};
/** Appearance → Font: the family and the italic switch everyone in the organization sees (stored as font_style expressive/classic). */
function FontSettings({ font, set, canEdit, ready }: { font: Font; set: (p: Partial<Font>) => void; canEdit: boolean; ready: boolean }) {
  // load Plus Jakarta Sans here so its card can show it before anyone picks it
  useEffect(loadJakarta, []);
  const italic = font.style === 'expressive';
  return (
    <div className="font-pick">
      {!ready && <p className="muted tpl-note"><Lock size={14} aria-hidden="true" /> Run database update 0034 in Supabase to save fonts. You can preview them now.</p>}
      <div role="group" aria-labelledby="fp-fam">
        <p className="fp-label" id="fp-fam">Font</p>
        <div className="fp-fams">
          {FONT_FAMILIES.map((f) => (
            <button key={f} type="button" className="fp-opt" data-ff={f} data-fs={font.style} aria-pressed={font.family === f} disabled={!canEdit} onClick={() => set({ family: f })}>
              <span className="fp-aa" aria-hidden="true">Aa</span><b>{FAMILY_TEXT[f][0]}</b><small>{FAMILY_TEXT[f][1]}</small>
            </button>))}
        </div>
      </div>
      <div className="fp-switch">
        <span className="grow"><b id="fp-it">Italic</b><small className="muted">Page titles and big numbers lean, like the preview. Off keeps everything upright.</small></span>
        <button type="button" role="switch" aria-checked={italic} aria-labelledby="fp-it" disabled={!canEdit}
          className={italic ? 'switch on' : 'switch'} onClick={() => set({ style: italic ? 'classic' : 'expressive' })}><span /></button>
      </div>
    </div>
  );
}
/** Access & security → require two-factor sign-in for admins (off by default). Turning it on needs your own two-factor first. */
function TwoFactorSetting({ on, set, ready, orgName }: { on: boolean; set: (v: boolean) => void; ready: boolean; orgName: string }) {
  const { mfaDone } = useAuth();
  const [setup, setSetup] = useState(false), [checking, setChecking] = useState(false);
  async function toggle() {
    if (on) return set(false);
    setChecking(true);
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    setChecking(false);
    if (data?.currentLevel === 'aal2') set(true); else setSetup(true);
  }
  return (
    <section className="card" aria-labelledby="mfa-h">
      <h3 id="mfa-h"><KeyRound size={16} aria-hidden="true" /> Two-factor sign-in for admins</h3>
      <div className="fp-switch">
        <span className="grow"><b id="mfa-l">Require it</b><small className="muted">Admins of {orgName} enter a code from an authenticator app after their password. Employees aren't affected. Off by default.</small></span>
        <button type="button" role="switch" aria-checked={on} aria-labelledby="mfa-l" disabled={!ready || checking || setup}
          className={on ? 'switch on' : 'switch'} onClick={toggle}><span /></button>
      </div>
      {!ready && <p className="muted tpl-note"><Lock size={14} aria-hidden="true" /> Run database update 0036 in Supabase to use this.</p>}
      {setup && (<>
        <p className="muted">First set it up for yourself, so you can't be locked out. Then save to turn it on for every admin.</p>
        <TwoFactorForm compact onDone={() => { setSetup(false); mfaDone(); set(true); }} onCancel={() => setSetup(false)} />
      </>)}
      {on && !setup && <p className="muted tpl-note"><ShieldCheck size={14} aria-hidden="true" /> After saving, any admin without two-factor is asked to set it up the next time they open {orgName}.</p>}
    </section>
  );
}

/** Data & export: every task (archived too), status history, activity, people and departments in one file. */
function ExportData({ orgId, orgName, say }: { orgId: string; orgName: string; say: (m: Msg) => void }) {
  async function run(f: ExportFormat) {
    try { await (await import('../lib/exportAll')).exportEverything(orgId, orgName, f); }
    catch (x) { say({ kind: 'error', text: `Export failed: ${(x as Error).message}` }); }
  }
  return (
    <section className="card os-sec" aria-labelledby="ex-h">
      <header><h3 id="ex-h"><Download size={16} aria-hidden="true" /> Export everything</h3>
        <p className="muted">One file with all of {orgName}'s data. Only admins can export; employees have no access to reports.</p></header>
      <ul className="ex-list">
        <li><b>Tasks</b><small className="muted">Every task, archived ones too, with status, people and dates</small></li>
        <li><b>Status history</b><small className="muted">Every status change, who made it and their comment</small></li>
        <li><b>Activity</b><small className="muted">Everything recorded in the activity log</small></li>
        <li><b>People and departments</b><small className="muted">Members, roles and departments</small></li>
      </ul>
      <div className="ex-go"><ExportMenu onExport={run} label="Export everything" />
        <small className="muted">Excel has one sheet for each. The PDF shows the newest 500 history and activity entries.</small></div>
    </section>
  );
}

/** Danger zone: delete the organization for good, only after typing its exact name. */
function DangerZone({ org, say }: { org: any; say: (m: Msg) => void }) {
  const { memberships, switchOrg } = useAuth();
  const [typed, setTyped] = useState(''), [busy, setBusy] = useState(false);
  const match = typed.trim() === org.name.trim();
  async function remove() {
    if (!match) return;
    setBusy(true);
    const { data, error } = await supabase.from('tt_organizations').delete().eq('id', org.id).select('id');
    setBusy(false);
    if (error || !data?.length) return say({ kind: 'error', text: error?.message ?? 'Only the person who created this organization can delete it.' });
    const next = memberships.find((m) => m.org_id !== org.id);
    try { localStorage.removeItem('tt-org'); } catch { /* ignore */ }
    if (next) switchOrg(next.org_id); else window.location.assign('/');
  }
  return (
    <section className="card os-sec os-danger" aria-labelledby="dz-h">
      <header><h3 id="dz-h"><AlertTriangle size={16} aria-hidden="true" /> Delete this organization</h3>
        <p className="muted">This permanently deletes {org.name} and everything in it. It can't be undone. Export everything first if you may need the data.</p></header>
      <ul className="dz-list">
        <li>Every task, sub-task, comment, file and status history</li>
        <li>Departments, templates, digest settings and the activity log</li>
        <li>Everyone's access to {org.name}; their accounts and other organizations stay</li>
      </ul>
      <label className="dz-confirm"><span>Type <b>{org.name}</b> to confirm</span>
        <input value={typed} autoComplete="off" spellCheck={false} aria-describedby="dz-h"
          onChange={(e) => { e.stopPropagation(); setTyped(e.target.value); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); remove(); } }} /></label>
      <button type="button" className="danger" disabled={!match || busy} onClick={remove}><Trash2 size={15} aria-hidden="true" />{busy ? 'Deleting…' : `Delete ${org.name}`}</button>
    </section>
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
