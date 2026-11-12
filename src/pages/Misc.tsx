import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { deleteAccount } from '../lib/deleteAccount';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { pickName } from '../lib/names';
import { useAuth } from '../lib/auth';
import { fetchAll, fmtTime, label, NO_ESC, rpc, usePeople } from '../lib/ui';
import { ask } from '../components/Dialog';
import { ListSkeleton } from '../components/Skeleton';
import { Building2, FolderKanban, History, ListChecks, Trash2, Users } from 'lucide-react';
import DeleteData from '../components/DeleteData';
import { byDay, describe, fold, FILTERS, type Category, type LogRow } from '../lib/activityText';
import { safeZone } from '../lib/greeting';
import { isNewOrg, markOrgsSeen, NEW_DAYS, onOrgsSeen, seenOrgs } from '../lib/newOrgs';
import TabThumb from '../components/TabThumb';
import { Count } from '../stageshow/kit/motion';
import './activity.css';

const PAGE = 50;
const CAT_ICON: Record<Category, typeof ListChecks> = { task: ListChecks, people: Users, org: Building2, work: FolderKanban };
const CAT_NAME: Record<Category, string> = { task: 'Task', people: 'People', org: 'Organization', work: 'Projects & clients' };
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

/** Who changed what, as a day-by-day timeline in the organization's time zone. */
export function ActivityLogs() {
  const { membership, session } = useAuth();
  const orgId = membership!.org_id;
  const zone = safeZone(membership!.time_zone);
  const { people, name: rawName, photo } = usePeople(orgId);
  const name = (id?: string | null) => { const n = rawName(id); return n === 'Removed member' ? 'a removed member' : n; }; // reads inside a sentence
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('');
  const [who, setWho] = useState('');
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load(from: number) {
    setBusy(true);
    let q = supabase.from('tt_activity_logs').select('*').eq('org_id', orgId).not('action', 'like', NO_ESC).order('created_at', { ascending: false }).range(from, from + PAGE - 1);
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
            <option value="">Everyone</option>{people.map((p) => <option key={p.id} value={p.id}>{pickName(p, people, session?.user.id)}</option>)}
          </select>
        </label>
      </div>
      <div className="seg al-filters" role="group" aria-label="Show">
        <TabThumb />
        {FILTERS.map((f) => <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>{f.name}</button>)}
      </div>

      <section className="card al-card" aria-busy={rows === null}>
        {rows === null ? <ListSkeleton rows={6} /> : rows.length === 0 ? (
          <div className="inbox-empty"><span className="empty-ico"><History size={22} aria-hidden="true" /></span><b>No activity yet</b>
            <p className="muted">{who || filter ? 'Nothing matches these filters. Try Everyone or All.' : 'Changes to tasks, people and settings will show up here.'}</p></div>
        ) : days.map((g) => (
          <section key={g.key} className="al-day" aria-labelledby={`d-${g.key}`}>
            <h3 id={`d-${g.key}`}>{g.title}<small><Count value={g.items.reduce((n, f) => n + f.count, 0)} /> {g.items.reduce((n, f) => n + f.count, 0) === 1 ? 'change' : 'changes'}</small></h3>
            <ol>{g.items.map(({ row: r, count }, i) => {
              const s = describe(r, name, (id) => titles[id]);
              const Icon = CAT_ICON[s.category];
              const actor = r.actor_id ? name(r.actor_id).replace(/^a /, 'A ') : 'Taskify';
              return (
                <li key={r.id} className={`al-item c-${s.category}`} style={{ '--i': Math.min(i, 12) } as React.CSSProperties}>
                  {/* the photo is clipped by its own circle; the category badge sits beside it, so neither spills into the next row */}
                  <span className="al-face" aria-hidden="true">
                    <span className="al-av">{photo(r.actor_id) ? <img src={photo(r.actor_id)!} alt="" /> : initials(actor)}</span>
                    <i className="al-kind"><Icon size={11} /></i>
                  </span>
                  <div className="al-main">
                    <p><b>{actor}</b> {s.verb}{s.target && <> {s.target.to ? <Link to={s.target.to}>{s.target.text}</Link> : s.target.text}</>}{s.rest}
                      {count > 1 && <span className="al-count" title={`${count} times in a row`}>×{count}</span>}</p>
                    <span className="al-cat">{CAT_NAME[s.category]}</span>
                  </div>
                  <time className="al-time" dateTime={r.created_at}>{time(r.created_at)}</time>
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
  const { switchOrg, membership, session } = useAuth();
  const uid = session!.user.id;
  const [seen, setSeen] = useState(() => seenOrgs(uid));
  useEffect(() => onOrgsSeen(() => setSeen(seenOrgs(uid))), [uid]);
  const seeOrg = (id: string) => markOrgsSeen(uid, [id]);
  const [s, setS] = useState<any>(null);
  const [orgs, setOrgs] = useState<any[] | null>(null);
  const [admins, setAdmins] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [cleaning, setCleaning] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const load = async () => {
    try {
      const [st, o, a] = await Promise.all([rpc('tt_platform_stats', {}), rpc('tt_platform_orgs', {}), rpc('tt_platform_admin_list', {})]);
      setS(st); setOrgs(o ?? []); setAdmins(a ?? []);
    } catch (e) { setMsg({ kind: 'error', text: /function/i.test((e as Error).message) ? 'The Platform page needs database update 0018.' : (e as Error).message }); setOrgs([]); }
  };
  useEffect(() => { load(); }, []);
  // where each platform admin was a member before (migration 0042); removing the role sends them back there
  const [origins, setOrigins] = useState<Map<string, { org_id: string; role: string }[]>>(new Map());
  useEffect(() => {
    supabase.from('tt_platform_admin_origins').select('user_id, org_id, role').then(({ data }) => {
      const m = new Map<string, { org_id: string; role: string }[]>();
      for (const o of data ?? []) m.set(o.user_id, [...(m.get(o.user_id) ?? []), o]);
      setOrigins(m);
    });
  }, [admins]);
  const [demoting, setDemoting] = useState<string | null>(null); // a platform admin with nowhere remembered: pick an organization
  const setAdmin = async (email: string, on: boolean, back?: { org: string; role: string }) => {
    try {
      await rpc('tt_platform_set_admin', { p_email: email, p_on: on, ...(back?.org ? { p_org: back.org, p_role: back.role } : {}) });
      setMsg({ kind: 'ok', text: on ? `${email} is now a platform admin. Their organizations are remembered for if you remove it again.`
        : `${email} is no longer a platform admin${back?.org ? ` and is back in ${orgs?.find((o) => o.id === back.org)?.name ?? 'the organization'}` : ''}.` });
      setDemoting(null); load();
    } catch (e) { setMsg({ kind: 'error', text: /function|p_org/i.test((e as Error).message) && back ? 'Sending them back needs database update 0042.' : (e as Error).message }); }
  };
  const orgNames = (list: { org_id: string; role: string }[]) => list.map((o) => `${orgs?.find((x) => x.id === o.org_id)?.name ?? 'an organization'} (${label(o.role === 'owner' ? 'admin' : o.role)})`).join(', ');
  const removeAdmin = async (a: any) => {
    const back = origins.get(a.user_id);
    if (!back?.length) { setDemoting(a.user_id); return; } // ask where to send them
    if ((await ask({ title: `Remove ${a.full_name || a.email} as platform admin?`, message: `They go back to ${orgNames(back)}, as before.`, confirmLabel: 'Remove', danger: true })).ok) setAdmin(a.email, false);
  };
  const review = async (o: any, approve: boolean) => {
    if (!approve && !(await ask({ title: `Reject ${o.name}?`, message: 'Its creator will be told it was not approved and won’t be able to use it.', confirmLabel: 'Reject', danger: true })).ok) return;
    try { await rpc('tt_platform_review_org', { p_org: o.id, p_approve: approve }); seeOrg(o.id); setMsg({ kind: 'ok', text: `${o.name} ${approve ? 'is approved' : 'was rejected'}. Its creator has been notified.` }); load(); }
    catch (e) { setMsg({ kind: 'error', text: /function/i.test((e as Error).message) ? 'Approvals need database update 0026.' : (e as Error).message }); }
  };
  const waiting = (orgs ?? []).filter((o) => o.status === 'pending');
  const shown = (orgs ?? []).filter((o) => !q || o.name.toLowerCase().includes(q.toLowerCase()));
  const fresh = (orgs ?? []).filter((o) => isNewOrg(o, seen));
  return (
    <>
      <div className="page-head">
        <div><h2 className="page-title">Admin site</h2><p className="page-sub">Everything across the CRM. Platform admins can open and manage every organization.</p></div>
        <div className="page-actions">
          <Link to="/organizations/new" className="pill-btn ghost">New organization</Link>
          <button type="button" className="pill-btn ghost danger-text" onClick={() => setCleaning(true)} disabled={!orgs?.length}><Trash2 size={16} aria-hidden="true" />Delete data</button>
        </div>
      </div>
      {cleaning && orgs && <DeleteData orgs={orgs.map((o) => ({ id: o.id, name: o.name }))} start={membership?.org_id} onClose={() => { setCleaning(false); load(); }} />}
      {msg && <p role={msg.kind === 'error' ? 'alert' : 'status'} className={`auth-msg ${msg.kind}`}><span>{msg.text}</span></p>}
      {s && <div className="perf-kpis">{Object.entries(s).map(([k, v], i) => <div key={k} className="perf-kpi" style={{ '--i': i } as React.CSSProperties}><b>{String(v)}</b><small>{label(k.replace(/^tt_/, ''))}</small></div>)}</div>}

      {waiting.length > 0 && (
        <section className="card" aria-labelledby="pw-h">
          <div className="panel-head"><h3 id="pw-h">Waiting for approval ({waiting.length})</h3></div>
          <p className="muted">New organizations can’t be used until you approve them. Creators are told to expect a decision within 24 hours.</p>
          <ul className="help-list">{waiting.map((o) => (
            <li key={o.id}><span className="grow"><b>{o.name}</b>{isNewOrg(o, seen) && <span className="new-badge">New</span>}<small className="muted">{o.creator_email ?? 'Unknown creator'}, {fmtTime(o.created_at)}</small></span>
              <button type="button" onClick={() => review(o, true)}>Approve</button>
              <button type="button" className="link danger-text" onClick={() => review(o, false)}>Reject</button></li>))}</ul>
        </section>
      )}

      <section className="card" aria-labelledby="po-h">
        <div className="panel-head"><h3 id="po-h">Organizations{fresh.length > 0 && <span className="new-badge">{fresh.length} new</span>}</h3>
          {fresh.length > 0 && <button type="button" className="link" onClick={() => markOrgsSeen(uid, fresh.map((o) => o.id))}>Mark all seen</button>}
          <input className="plat-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search organizations" aria-label="Search organizations" /></div>
        {orgs === null ? <p className="muted">Loading…</p> : shown.length === 0 ? <p className="muted">No organizations.</p> : (
          <table className="emp-table">
            <thead><tr><th>Organization</th><th>Status</th><th>Members</th><th>Open tasks</th><th>Time zone</th><th>Created</th><th><span className="sr-only">Open</span></th></tr></thead>
            <tbody>{shown.map((o) => (
              <tr key={o.id} className={isNewOrg(o, seen) ? 'is-new' : undefined}><td><b>{o.name}</b>{isNewOrg(o, seen) && <span className="new-badge" title={`Added in the last ${NEW_DAYS} days`}>New</span>}{o.id === membership?.org_id && <small className="muted"> (open now)</small>}</td>
                <td>{o.status === 'rejected' ? <button type="button" className="link" title="Approve it after all" onClick={() => review(o, true)}>Rejected</button> : label(o.status ?? 'approved')}</td><td>{o.members}</td><td>{o.open_tasks}</td><td>{o.time_zone}</td><td>{fmtTime(o.created_at)}</td>
                <td>{o.id !== membership?.org_id && <button type="button" className="pill-btn ghost" onClick={() => { seeOrg(o.id); switchOrg(o.id); }}>Open</button>}</td></tr>))}</tbody>
          </table>)}
      </section>

      <section className="card" aria-labelledby="pa-h">
        <div className="panel-head"><h3 id="pa-h">Platform admins</h3></div>
        <p className="muted">Platform admins control every organization. Organization admins (set on each organization's Employees page) control only their own organization.</p>
        <ul className="help-list">{admins.map((a) => (
          <li key={a.user_id}><span className="grow"><b>{a.full_name || a.email}</b>
            <small className="muted">{a.email}{origins.get(a.user_id)?.length ? `. Came from ${orgNames(origins.get(a.user_id)!)}` : ''}</small></span>
            {admins.length > 1 && demoting !== a.user_id && <button type="button" className="link danger-text" onClick={() => removeAdmin(a)}>Remove</button>}
            {demoting === a.user_id && (
              <form className="inline-add" onSubmit={(e: FormEvent<HTMLFormElement>) => {
                e.preventDefault(); const f = new FormData(e.currentTarget);
                setAdmin(a.email, false, { org: String(f.get('org') ?? ''), role: String(f.get('role') ?? 'employee') });
              }}>
                <select name="org" aria-label="Send them to organization" defaultValue="">
                  <option value="">No organization</option>
                  {(orgs ?? []).filter((o) => (o.status ?? 'approved') === 'approved').map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
                <select name="role" aria-label="Role there" defaultValue="employee"><option value="employee">Employee</option><option value="admin">Admin</option></select>
                <button type="submit" className="danger">Remove</button>
                <button type="button" className="link" onClick={() => setDemoting(null)}>Cancel</button>
              </form>)}</li>))}</ul>
        {demoting && <p className="muted">Nothing is remembered about where this person was before, so pick the organization and role they go back to.</p>}
        <form className="inline-add" onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = e.currentTarget, em = String(new FormData(f).get('email')).trim(); if (em) { setAdmin(em, true); f.reset(); } }}>
          <input name="email" type="email" required placeholder="Email of an existing account" aria-label="Email of new platform admin" /><button type="submit">Make platform admin</button>
        </form>
        <p className="muted">Platform admins don’t belong to any organization. Making someone a platform admin takes them out of every organization they were in, and remembers where they were: removing the role sends them back with the same role and departments. To remove someone from Taskify entirely, delete their account under All users.</p>
      </section>

      <AllUsers me={uid} orgs={orgs ?? []} admins={admins} say={setMsg} reload={load} />
    </>
  );
}

const SHOW = 50;
/** Every account on Taskify, with its organizations; platform admins can delete any account but their own. */
function AllUsers({ me, orgs, admins, say, reload }: { me: string; orgs: any[]; admins: any[]; say: (m: { kind: 'ok' | 'error'; text: string }) => void; reload: () => void }) {
  const [users, setUsers] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const load = useCallback(async () => {
    try {
      const [p, m] = await Promise.all([
        fetchAll(() => supabase.from('tt_profiles').select('user_id, full_name, email').order('user_id')),
        fetchAll(() => supabase.from('tt_org_members').select('*').order('org_id').order('user_id')),
      ]);
      const byUser = new Map<string, any[]>();
      for (const x of m) byUser.set(x.user_id, [...(byUser.get(x.user_id) ?? []), x]);
      setUsers(p.map((u) => ({ ...u, mem: byUser.get(u.user_id) ?? [] })).sort((a, b) => (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '')));
    } catch (e) { say({ kind: 'error', text: (e as Error).message }); setUsers([]); }
  }, [say]);
  useEffect(() => { load(); }, [load]);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const isPA = new Set(admins.map((a) => a.user_id));
  const t = q.trim().toLowerCase();
  const found = (users ?? []).filter((u) => !t || `${u.full_name ?? ''} ${u.email ?? ''}`.toLowerCase().includes(t));
  const del = async (u: any) => {
    try {
      if (await deleteAccount({ id: u.user_id, name: u.full_name || u.email, email: u.email })) {
        say({ kind: 'ok', text: `${u.full_name || u.email}'s account was deleted.` }); load(); reload();
      }
    } catch (e) { say({ kind: 'error', text: (e as Error).message }); }
  };
  return (
    <section className="card" aria-labelledby="au-h">
      <div className="panel-head"><h3 id="au-h">All users{users && ` (${users.length})`}</h3>
        <input className="plat-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" aria-label="Search users" /></div>
      <p className="muted">Every account on Taskify. Deleting one removes that person's login and everything that is theirs (comments, assignments, history); tasks and files they created stay.</p>
      {users === null ? <p className="muted">Loading…</p> : found.length === 0 ? <p className="muted">No users match.</p> : (
        <table className="emp-table">
          <thead><tr><th>Name</th><th>Email</th><th>Organizations</th><th><span className="sr-only">Delete</span></th></tr></thead>
          <tbody>{found.slice(0, SHOW).map((u) => (
            <tr key={u.user_id}><td><b>{u.full_name || '—'}</b>{u.user_id === me && <small className="muted"> (you)</small>}</td><td>{u.email}</td>
              <td>{isPA.has(u.user_id) ? 'Platform admin' : u.mem.length ? u.mem.map((x: any) => `${orgName.get(x.org_id) ?? 'Unknown'} (${label(x.role)}${x.joined_at === null ? ', invited' : x.active ? '' : ', inactive'})`).join(', ') : <span className="muted">None</span>}</td>
              <td>{u.user_id !== me && <button type="button" className="link danger-text" onClick={() => del(u)}>Delete</button>}</td></tr>))}</tbody>
        </table>)}
      {found.length > SHOW && <p className="muted">Showing {SHOW} of {found.length}. Search to find someone.</p>}
    </section>
  );
}
