import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import ExportMenu, { type ExportFormat } from '../components/ExportMenu';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { fetchAll, fileStamp, fmtTime, label, rpc, saveBlob, usePeople } from '../lib/ui';
import { ask } from '../components/Dialog';
import { ListSkeleton } from '../components/Skeleton';
import { Building2, FolderKanban, History, ListChecks, Users } from 'lucide-react';
import { byDay, describe, fold, FILTERS, type Category, type LogRow } from '../lib/activityText';
import { safeZone } from '../lib/greeting';

const PAGE = 50;
const CAT_ICON: Record<Category, typeof ListChecks> = { task: ListChecks, people: Users, org: Building2, work: FolderKanban };
const CAT_NAME: Record<Category, string> = { task: 'Task', people: 'People', org: 'Organization', work: 'Projects & clients' };
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

/** Who changed what, as a day-by-day timeline in the organization's time zone. */
export function ActivityLogs() {
  const { membership } = useAuth();
  const orgId = membership!.org_id;
  const zone = safeZone(membership!.time_zone);
  const { people, name: rawName } = usePeople(orgId);
  const name = (id?: string | null) => { const n = rawName(id); return n === 'Unknown' ? 'a former member' : n; }; // people who left the organization
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('');
  const [who, setWho] = useState('');
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load(from: number) {
    setBusy(true);
    let q = supabase.from('tt_activity_logs').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).range(from, from + PAGE - 1);
    const types = FILTERS.find((f) => f.key === filter)!.types;
    if (types.length) q = q.in('entity_type', types);
    if (who) q = q.eq('actor_id', who);
    const { data } = await q;
    const got = (data ?? []) as LogRow[];
    const ids = [...new Set(got.filter((r) => r.entity_type === 'task').map((r) => r.entity_id))];
    if (ids.length) {
      const { data: t } = await supabase.from('tt_tasks').select('id, title').in('id', ids);
      setTitles((old) => ({ ...old, ...Object.fromEntries((t ?? []).map((x) => [x.id, x.title])) }));
    }
    setRows((old) => (from ? [...(old ?? []), ...got] : got));
    setMore(got.length === PAGE);
    setBusy(false);
  }
  useEffect(() => { setRows(null); load(0); }, [orgId, filter, who]); // eslint-disable-line react-hooks/exhaustive-deps

  const time = (s: string) => new Date(s).toLocaleTimeString('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
  const days = rows ? byDay(fold(rows), (f) => f.row.created_at, zone) : [];

  return (
    <div className="al">
      <div className="page-head">
        <div>
          <h2 className="page-title">Activity log</h2>
          <p className="page-sub">Everything that changed in {membership!.org_name}, newest first. Times are in {zone.replace(/_/g, ' ')}.</p>
        </div>
        <label className="al-who"><span className="sr-only">Filter by person</span>
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Everyone</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>
      <div className="seg al-filters" role="group" aria-label="Show">
        {FILTERS.map((f) => <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>{f.name}</button>)}
      </div>

      <section className="card al-card" aria-busy={rows === null}>
        {rows === null ? <ListSkeleton rows={6} /> : rows.length === 0 ? (
          <div className="inbox-empty"><span className="empty-ico"><History size={22} aria-hidden="true" /></span><b>No activity yet</b>
            <p className="muted">{who || filter ? 'Nothing matches these filters. Try Everyone or All.' : 'Changes to tasks, people and settings will show up here.'}</p></div>
        ) : days.map((g) => (
          <section key={g.key} className="al-day" aria-labelledby={`d-${g.key}`}>
            <h3 id={`d-${g.key}`}>{g.title}<small>{g.items.reduce((n, f) => n + f.count, 0)}</small></h3>
            <ol>{g.items.map(({ row: r, count }) => {
              const s = describe(r, name, (id) => titles[id]);
              const Icon = CAT_ICON[s.category];
              const actor = r.actor_id ? name(r.actor_id).replace(/^a /, 'A ') : 'Taskify';
              return (
                <li key={r.id} className={`al-item c-${s.category}`}>
                  <span className="avatar sm al-av" aria-hidden="true">{initials(actor)}<i><Icon size={11} /></i></span>
                  <p><b>{actor}</b> {s.verb}{s.target && <> {s.target.to ? <Link to={s.target.to}>{s.target.text}</Link> : s.target.text}</>}{s.rest}
                    {count > 1 && <span className="al-count" title={`${count} times in a row`}>×{count}</span>}</p>
                  <small className="al-meta"><time dateTime={r.created_at}>{time(r.created_at)}</time><span>{CAT_NAME[s.category]}</span></small>
                </li>);
            })}</ol>
          </section>))}
        {more && <button type="button" className="pill-btn ghost al-older" disabled={busy} onClick={() => load(rows!.length)}>{busy ? 'Loading…' : 'Load older activity'}</button>}
      </section>
    </div>
  );
}

/** Whole-CRM control for platform admins: every organization, and who else is a platform admin. */
export function Platform() {
  const { switchOrg, membership } = useAuth();
  const [s, setS] = useState<any>(null);
  const [orgs, setOrgs] = useState<any[] | null>(null);
  const [admins, setAdmins] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const load = async () => {
    try {
      const [st, o, a] = await Promise.all([rpc('tt_platform_stats', {}), rpc('tt_platform_orgs', {}), rpc('tt_platform_admin_list', {})]);
      setS(st); setOrgs(o ?? []); setAdmins(a ?? []);
    } catch (e) { setMsg({ kind: 'error', text: /function/i.test((e as Error).message) ? 'The Platform page needs database update 0018.' : (e as Error).message }); setOrgs([]); }
  };
  useEffect(() => { load(); }, []);
  const setAdmin = async (email: string, on: boolean) => {
    try { await rpc('tt_platform_set_admin', { p_email: email, p_on: on }); setMsg({ kind: 'ok', text: on ? `${email} is now a platform admin.` : `${email} is no longer a platform admin.` }); load(); }
    catch (e) { setMsg({ kind: 'error', text: (e as Error).message }); }
  };
  const review = async (o: any, approve: boolean) => {
    if (!approve && !(await ask({ title: `Reject ${o.name}?`, message: 'Its creator will be told it was not approved and won’t be able to use it.', confirmLabel: 'Reject', danger: true })).ok) return;
    try { await rpc('tt_platform_review_org', { p_org: o.id, p_approve: approve }); setMsg({ kind: 'ok', text: `${o.name} ${approve ? 'is approved' : 'was rejected'}. Its creator has been notified.` }); load(); }
    catch (e) { setMsg({ kind: 'error', text: /function/i.test((e as Error).message) ? 'Approvals need database update 0026.' : (e as Error).message }); }
  };
  const waiting = (orgs ?? []).filter((o) => o.status === 'pending');
  const shown = (orgs ?? []).filter((o) => !q || o.name.toLowerCase().includes(q.toLowerCase()));
  // every organization side by side; reads go through RLS, which lets platform admins see all organizations
  async function exportAs(f: ExportFormat) {
    setMsg(null);
    try {
      const [orgs, members, profiles, depts, tasks] = await Promise.all([
        fetchAll(() => supabase.from('tt_organizations').select('id, name, created_at').order('id')),
        fetchAll(() => supabase.from('tt_org_members').select('org_id, user_id, role, active').order('org_id').order('user_id')),
        fetchAll(() => supabase.from('tt_profiles').select('user_id, full_name, email').order('user_id')),
        fetchAll(() => supabase.from('tt_departments').select('id, org_id, name').order('id')),
        fetchAll(() => supabase.from('tt_tasks').select('id, org_id, title, status, priority, department_id, due_date, start_date, created_at, completed_at, tt_task_assignees(user_id)').is('archived_at', null).order('id')),
      ]);
      const r = await import('../lib/reportWorkbook');
      const input = { orgs, members, profiles, depts, tasks, label }, file = fileStamp('Taskify_all_organizations');
      if (f === 'xlsx') saveBlob(`${file}.xlsx`, r.platformWorkbook(input));
      else (await import('../lib/printReport')).printReport(r.platformPdf(input));
      setMsg({ kind: 'ok', text: `Exported ${orgs.length} organizations and ${tasks.length} tasks.` });
    } catch (e) { setMsg({ kind: 'error', text: (e as Error).message }); }
  }
  return (
    <>
      <div className="page-head">
        <div><h2 className="page-title">Admin site</h2><p className="page-sub">Everything across the CRM. Platform admins can open and manage every organization.</p></div>
        <div className="page-actions">
          <ExportMenu onExport={exportAs} label="Export report" />
          <Link to="/organizations/new" className="pill-btn ghost">New organization</Link>
        </div>
      </div>
      {msg && <p role={msg.kind === 'error' ? 'alert' : 'status'} className={`auth-msg ${msg.kind}`}><span>{msg.text}</span></p>}
      {s && <div className="perf-kpis">{Object.entries(s).map(([k, v], i) => <div key={k} className="perf-kpi" style={{ '--i': i } as React.CSSProperties}><b>{String(v)}</b><small>{label(k.replace(/^tt_/, ''))}</small></div>)}</div>}

      {waiting.length > 0 && (
        <section className="card" aria-labelledby="pw-h">
          <div className="panel-head"><h3 id="pw-h">Waiting for approval ({waiting.length})</h3></div>
          <p className="muted">New organizations can’t be used until you approve them. Creators are told to expect a decision within 24 hours.</p>
          <ul className="help-list">{waiting.map((o) => (
            <li key={o.id}><span className="grow"><b>{o.name}</b><small className="muted">{o.creator_email ?? 'Unknown creator'}, {fmtTime(o.created_at)}</small></span>
              <button type="button" onClick={() => review(o, true)}>Approve</button>
              <button type="button" className="link danger-text" onClick={() => review(o, false)}>Reject</button></li>))}</ul>
        </section>
      )}

      <section className="card" aria-labelledby="po-h">
        <div className="panel-head"><h3 id="po-h">Organizations</h3>
          <input className="plat-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search organizations" aria-label="Search organizations" /></div>
        {orgs === null ? <p className="muted">Loading…</p> : shown.length === 0 ? <p className="muted">No organizations.</p> : (
          <table className="emp-table">
            <thead><tr><th>Organization</th><th>Status</th><th>Members</th><th>Open tasks</th><th>Time zone</th><th>Created</th><th><span className="sr-only">Open</span></th></tr></thead>
            <tbody>{shown.map((o) => (
              <tr key={o.id}><td><b>{o.name}</b>{o.id === membership?.org_id && <small className="muted"> (open now)</small>}</td>
                <td>{o.status === 'rejected' ? <button type="button" className="link" title="Approve it after all" onClick={() => review(o, true)}>Rejected</button> : label(o.status ?? 'approved')}</td><td>{o.members}</td><td>{o.open_tasks}</td><td>{o.time_zone}</td><td>{fmtTime(o.created_at)}</td>
                <td>{o.id !== membership?.org_id && <button type="button" className="pill-btn ghost" onClick={() => switchOrg(o.id)}>Open</button>}</td></tr>))}</tbody>
          </table>)}
      </section>

      <section className="card" aria-labelledby="pa-h">
        <div className="panel-head"><h3 id="pa-h">Platform admins</h3></div>
        <p className="muted">Platform admins control every organization. Organization admins (set on each organization's Employees page) control only their own organization.</p>
        <ul className="help-list">{admins.map((a) => (
          <li key={a.user_id}><span className="grow"><b>{a.full_name || a.email}</b><small className="muted">{a.email}</small></span>
            {admins.length > 1 && <button type="button" className="link danger-text" onClick={() => setAdmin(a.email, false)}>Remove</button>}</li>))}</ul>
        <form className="inline-add" onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = e.currentTarget, em = String(new FormData(f).get('email')).trim(); if (em) { setAdmin(em, true); f.reset(); } }}>
          <input name="email" type="email" required placeholder="Email of an existing account" aria-label="Email of new platform admin" /><button type="submit">Make platform admin</button>
        </form>
        <p className="muted">Platform admins don’t belong to any organization. Making someone a platform admin takes them out of every organization they were in; they keep full access to all of them from here.</p>
      </section>
    </>
  );
}
