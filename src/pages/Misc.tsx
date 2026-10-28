import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { fmtTime, label, rpc, usePeople } from '../lib/ui';

export function Contacts() {
  const { membership } = useAuth();
  const orgId = membership!.org_id;
  const canInvite = can(membership!.role, 'client:write');
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    let qy = supabase.from('tt_client_contacts').select('*, clients:tt_clients(name)').eq('org_id', orgId).order('full_name').limit(200);
    const term = q.trim().replace(/[,()%*]/g, ' ');
    if (term) qy = qy.or(`full_name.ilike.%${term}%,email.ilike.%${term}%`);
    qy.then(({ data }) => setRows(data ?? []));
  }, [orgId, q]);

  async function invite(c: any) {
    if (!c.email) return setMsg('This contact has no email.');
    const { data: s } = await supabase.auth.getSession();
    const r = await fetch('/api/invite', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token}` },
      body: JSON.stringify({ org_id: orgId, email: c.email, full_name: c.full_name, client_contact_id: c.id }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? `Portal invitation sent to ${c.email}.` : j.error ?? 'Invite failed');
  }
  return (
    <div className="card">
      <h2>Contacts</h2>
      <div className="row filters"><input aria-label="Search contacts" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {msg && <p role="status">{msg}</p>}
      {rows.length === 0 ? <p>No contacts found. Add contacts from a client profile.</p> : (
        <table><thead><tr><th>Name</th><th>Client</th><th>Title</th><th>Email</th><th>Portal</th>{canInvite && <th />}</tr></thead>
          <tbody>{rows.map((c) => (
            <tr key={c.id}><td>{c.full_name}</td><td><Link to={`/clients/${c.client_id}`}>{c.clients?.name}</Link></td><td>{c.job_title}</td><td>{c.email}</td>
              <td>{c.user_id ? 'Active' : 'Not invited'}</td>
              {canInvite && <td>{!c.user_id && <button className="link" onClick={() => invite(c)}>Invite to portal</button>}</td>}</tr>))}</tbody></table>)}
    </div>
  );
}

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
        <option value="">All</option>{['client', 'project', 'task', 'organization'].map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></div>
      {rows.length === 0 ? <p>No activity.</p> : (
        <table><thead><tr><th>When</th><th>Who</th><th>Entity</th><th>Action</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td>{fmtTime(r.created_at)}</td><td>{name(r.actor_id)}</td>
            <td>{r.entity_type === 'task' ? <Link to={`/tasks/${r.entity_id}`}>task</Link> : r.entity_type === 'client' ? <Link to={`/clients/${r.entity_id}`}>client</Link> : r.entity_type === 'project' ? <Link to={`/projects/${r.entity_id}`}>project</Link> : label(r.entity_type)}</td>
            <td>{label(r.action)}</td></tr>)}</tbody></table>)}
      <div className="row"><button disabled={!page} onClick={() => setPage(page - 1)}>Newer</button><button disabled={rows.length < 50} onClick={() => setPage(page + 1)}>Older</button></div>
    </div>
  );
}

export function Settings() {
  const { membership, refresh } = useAuth();
  const orgId = membership!.org_id;
  const [msg, setMsg] = useState('');
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { error } = await supabase.from('tt_organizations').update({ name: String(f.get('name')).trim(), time_zone: f.get('tz') }).eq('id', orgId);
    if (!error) { await supabase.from('tt_activity_logs').insert({ org_id: orgId, entity_type: 'organization', entity_id: orgId, action: 'settings_updated', actor_id: (await supabase.auth.getUser()).data.user?.id }); refresh(); }
    setMsg(error ? (error.message.includes('time zone') ? 'Unknown time zone' : error.message) : 'Saved.');
  }
  return (
    <div className="card">
      <h2>Organization Settings</h2>
      <form className="grid" onSubmit={save}>
        <label>Name<input name="name" defaultValue={membership!.org_name} required /></label>
        <label>Time zone (IANA, e.g. America/New_York)<input name="tz" defaultValue={membership!.time_zone} required /></label>
        <button type="submit">Save</button>
      </form>
      {msg && <p role="status">{msg}</p>}
      <p><small>Recurrence and reminders use this time zone. Logo/branding upload is not implemented.</small></p>
    </div>
  );
}

export function Profile() {
  const { session, membership } = useAuth();
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const uid = session!.user.id;
  useEffect(() => { supabase.from('tt_profiles').select('full_name').eq('user_id', uid).maybeSingle().then(({ data }) => setName(data?.full_name ?? '')); }, [uid]);
  return (
    <div className="card">
      <h2>My Profile</h2>
      <p>{session!.user.email}{membership && <> · {label(membership.role)} at {membership.org_name}</>}</p>
      <form className="row filters" onSubmit={async (e) => { e.preventDefault(); const { error } = await supabase.from('tt_profiles').update({ full_name: name.trim() }).eq('user_id', uid); setMsg(error ? error.message : 'Saved.'); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} required aria-label="Full name" /><button type="submit">Save name</button>
      </form>
      <form className="row filters" onSubmit={async (e) => { e.preventDefault(); const p = String(new FormData(e.currentTarget).get('pw')); const { error } = await supabase.auth.updateUser({ password: p }); setMsg(error ? error.message : 'Password changed.'); e.currentTarget.reset(); }}>
        <input name="pw" type="password" minLength={8} placeholder="New password" required aria-label="New password" /><button type="submit">Change password</button>
      </form>
      {msg && <p role="status">{msg}</p>}
    </div>
  );
}

export function Platform() {
  const [s, setS] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => { rpc('tt_platform_stats', {}).then(setS).catch((e) => setErr(e.message)); }, []);
  return (
    <div className="card">
      <h2>Platform</h2>
      {err && <p role="alert">{err}</p>}
      {s && <div className="stats">{Object.entries(s).map(([k, v]) => <div key={k}><b>{String(v)}</b><span>{label(k)}</span></div>)}</div>}
    </div>
  );
}
