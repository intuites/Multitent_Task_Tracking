import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { fmtTime, label, rpc, usePeople } from '../lib/ui';

export function ActivityLogs() {
  const { membership } = useAuth();
  const orgId = membership!.org_id;
  const { name } = usePeople(orgId);
  const [rows, setRows] = useState<any[]>([]);
  const [type, setType] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => {
    let q = supabase.from('tt_activity_logs').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).range(page * 50, page * 50 + 49);
    if (type) q = q.eq('entity_type', type);
    q.then(({ data }) => setRows(data ?? []));
  }, [orgId, type, page]);
  return (
    <div className="card">
      <h2>Activity Logs</h2>
      <div className="row filters"><select aria-label="Filter by entity type" value={type} onChange={(e) => { setPage(0); setType(e.target.value); }}>
        <option value="">All</option>{['task', 'organization'].map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></div>
      {rows.length === 0 ? <p>No activity.</p> : (
        <table><thead><tr><th>When</th><th>Who</th><th>Entity</th><th>Action</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td>{fmtTime(r.created_at)}</td><td>{name(r.actor_id)}</td>
            <td>{r.entity_type === 'task' ? <Link to={`/tasks/${r.entity_id}`}>task</Link> : label(r.entity_type)}</td>
            <td>{label(r.action)}</td></tr>)}</tbody></table>)}
      <div className="row"><button disabled={!page} onClick={() => setPage(page - 1)}>Newer</button><button disabled={rows.length < 50} onClick={() => setPage(page + 1)}>Older</button></div>
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
  const shown = (orgs ?? []).filter((o) => !q || o.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="page-head">
        <div><h2 className="page-title">Admin site</h2><p className="page-sub">Everything across the CRM. Platform admins can open and manage every organization.</p></div>
        <div className="page-actions"><Link to="/organizations/new" className="pill-btn">New organization</Link></div>
      </div>
      {msg && <p role={msg.kind === 'error' ? 'alert' : 'status'} className={`auth-msg ${msg.kind}`}><span>{msg.text}</span></p>}
      {s && <div className="perf-kpis">{Object.entries(s).map(([k, v], i) => <div key={k} className="perf-kpi" style={{ '--i': i } as React.CSSProperties}><b>{String(v)}</b><small>{label(k.replace(/^tt_/, ''))}</small></div>)}</div>}

      <section className="card" aria-labelledby="po-h">
        <div className="panel-head"><h3 id="po-h">Organizations</h3>
          <input className="plat-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search organizations" aria-label="Search organizations" /></div>
        {orgs === null ? <p className="muted">Loading…</p> : shown.length === 0 ? <p className="muted">No organizations.</p> : (
          <table className="emp-table">
            <thead><tr><th>Organization</th><th>Members</th><th>Open tasks</th><th>Time zone</th><th>Created</th><th><span className="sr-only">Open</span></th></tr></thead>
            <tbody>{shown.map((o) => (
              <tr key={o.id}><td><b>{o.name}</b>{o.id === membership?.org_id && <small className="muted"> (open now)</small>}</td><td>{o.members}</td><td>{o.open_tasks}</td><td>{o.time_zone}</td><td>{fmtTime(o.created_at)}</td>
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
      </section>
    </>
  );
}
