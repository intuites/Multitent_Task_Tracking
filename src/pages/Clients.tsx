import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { logActivity } from '../lib/activity';
import { Badge, label } from '../lib/ui';
import { ListSkeleton } from '../components/Skeleton';

export const CLIENT_STATUSES = ['lead', 'prospect', 'active', 'on_hold', 'inactive', 'archived'];
const PAGE = 20;

export default function Clients() {
  const { membership, session } = useAuth();
  const orgId = membership!.org_id;
  const canWrite = can(membership!.role, 'client:write');
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('tt_clients').select('*', { count: 'exact' }).eq('org_id', orgId)
      .order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (status) query = query.eq('status', status); else query = query.neq('status', 'archived');
    if (type) query = query.eq('type', type);
    // strip chars that would break PostgREST's or() filter syntax
    const term = q.trim().replace(/[,()%*]/g, ' ');
    if (term) query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`);
    const { data, count, error } = await query;
    setError(error?.message ?? '');
    setRows(data ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [orgId, page, q, status, type]);

  useEffect(() => { load(); }, [load]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { data, error } = await supabase.from('tt_clients').insert({
      org_id: orgId, owner_id: session!.user.id,
      name: String(f.get('name')).trim(), type: f.get('type'), status: f.get('status'),
      email: String(f.get('email')).trim() || null, phone: String(f.get('phone')).trim() || null,
      industry: String(f.get('industry')).trim() || null,
    }).select('id').single();
    if (error) return setError(error.message);
    await logActivity(orgId, session!.user.id, 'client', data.id, 'created');
    setShowForm(false);
    load();
  }

  return (
    <div className="card">
      <div className="row">
        <h2>Clients</h2>
        {canWrite && <button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Cancel' : 'New client'}</button>}
      </div>
      {showForm && (
        <form className="grid" onSubmit={create}>
          <label>Name<input name="name" required maxLength={200} /></label>
          <label>Type<select name="type"><option value="business">Business</option><option value="individual">Individual</option></select></label>
          <label>Status<select name="status" defaultValue="lead">{CLIENT_STATUSES.filter((s) => s !== 'archived').map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></label>
          <label>Email<input name="email" type="email" /></label>
          <label>Phone<input name="phone" /></label>
          <label>Industry<input name="industry" /></label>
          <button type="submit">Save</button>
        </form>
      )}
      <div className="row filters">
        <input aria-label="Search clients" placeholder="Search name, email, phone" value={q} onChange={(e) => { setPage(0); setQ(e.target.value); }} />
        <select aria-label="Filter by status" value={status} onChange={(e) => { setPage(0); setStatus(e.target.value); }}>
          <option value="">All active</option>{CLIENT_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
        <select aria-label="Filter by type" value={type} onChange={(e) => { setPage(0); setType(e.target.value); }}>
          <option value="">Any type</option><option value="business">Business</option><option value="individual">Individual</option>
        </select>
      </div>
      {error && <p role="alert">{error}</p>}
      {loading ? <ListSkeleton /> : rows.length === 0 ? <p>No clients found.{canWrite && ' Use “New client” to add one.'}</p> : (
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Email</th><th>Phone</th></tr></thead>
          <tbody>{rows.map((c) => (
            <tr key={c.id}><td><Link to={`/clients/${c.id}`}>{c.name}</Link></td><td>{label(c.type)}</td><td><Badge v={c.status} /></td><td>{c.email}</td><td>{c.phone}</td></tr>
          ))}</tbody>
        </table>
      )}
      <div className="row">
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</button>
        <span>Page {page + 1} of {Math.max(1, Math.ceil(total / PAGE))} ({total})</span>
        <button disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}
