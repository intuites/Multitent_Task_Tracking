import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { logActivity } from '../lib/activity';
import { CLIENT_STATUSES } from './Clients';
import FilePanel from '../components/FilePanel';
import { Tabs, panelProps } from '../components/Tabs';
import { ask } from '../components/Dialog';
import { Badge, label } from '../lib/ui';
import { PageSkeleton } from '../components/Skeleton';

type Tab = 'overview' | 'contacts' | 'projects' | 'tasks' | 'documents' | 'notes' | 'activity';

export default function ClientProfile() {
  const { id } = useParams();
  const { membership, session } = useAuth();
  const orgId = membership!.org_id;
  const uid = session!.user.id;
  const canWrite = can(membership!.role, 'client:write');
  const [client, setClient] = useState<any>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [projs, setProjs] = useState<any[]>([]);
  const [tks, setTks] = useState<any[]>([]);
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // org_id filter is defense in depth; RLS is the real boundary
    const c = await supabase.from('tt_clients').select('*').eq('id', id!).eq('org_id', orgId).maybeSingle();
    setClient(c.data);
    if (c.data) {
      const [ct, nt, ac, pj, tk] = await Promise.all([
        supabase.from('tt_client_contacts').select('*').eq('client_id', id!).order('is_primary', { ascending: false }),
        supabase.from('tt_client_notes').select('*').eq('client_id', id!).order('created_at', { ascending: false }),
        supabase.from('tt_activity_logs').select('*').eq('entity_type', 'client').eq('entity_id', id!).order('created_at', { ascending: false }).limit(50),
        supabase.from('tt_projects').select('id, name, status').eq('client_id', id!).order('created_at', { ascending: false }),
        supabase.from('tt_tasks').select('id, title, status').eq('client_id', id!).is('archived_at', null).order('created_at', { ascending: false }).limit(100),
      ]);
      setProjs(pj.data ?? []); setTks(tk.data ?? []);
      setContacts(ct.data ?? []); setNotes(nt.data ?? []); setActivity(ac.data ?? []);
    }
    setLoading(false);
  }, [id, orgId]);
  useEffect(() => { load(); }, [load]);

  async function setStatus(status: string) {
    if (status === 'archived' && !(await ask({ title: 'Archive this client?', message: 'It will be hidden from the client list. You can restore it later.', confirmLabel: 'Archive', danger: true })).ok) return;
    const { error } = await supabase.from('tt_clients').update({ status, updated_at: new Date().toISOString() }).eq('id', id!);
    if (error) return setError(error.message);
    await logActivity(orgId, uid, 'client', id!, status === 'archived' ? 'archived' : 'status_changed', { from: client.status, to: status });
    load();
  }

  async function saveClient(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const txt = (k: string) => String(f.get(k) ?? '').trim() || null;
    const website = txt('website');
    // only http(s) links are rendered as clickable, so reject javascript: and similar schemes here
    if (website && !/^https?:\/\//i.test(website)) return setError('Website must start with http:// or https://');
    const { error } = await supabase.from('tt_clients').update({
      name: txt('name'), type: f.get('type'), email: txt('email'), phone: txt('phone'), industry: txt('industry'),
      website, source: txt('source'), address: txt('address'),
      tags: String(f.get('tags') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      updated_at: new Date().toISOString(),
    }).eq('id', id!).eq('org_id', orgId);
    if (error) return setError(error.message);
    await logActivity(orgId, uid, 'client', id!, 'edited');
    setError(''); setEditing(false); load();
  }

  async function addContact(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const { error } = await supabase.from('tt_client_contacts').insert({
      org_id: orgId, client_id: id, full_name: String(f.get('full_name')).trim(),
      job_title: String(f.get('job_title')).trim() || null, email: String(f.get('email')).trim() || null,
      phone: String(f.get('phone')).trim() || null, is_primary: f.get('is_primary') === 'on',
      can_approve: f.get('can_approve') === 'on',
    });
    if (error) return setError(error.message.includes('one_primary') ? 'This client already has a primary contact.' : error.message);
    await logActivity(orgId, uid, 'client', id!, 'contact_added');
    form.reset(); setError(''); load();
  }

  async function addNote(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = String(new FormData(form).get('body')).trim();
    if (!body) return;
    const { error } = await supabase.from('tt_client_notes').insert({ org_id: orgId, client_id: id, body, created_by: uid });
    if (error) return setError(error.message);
    await logActivity(orgId, uid, 'client', id!, 'note_added');
    form.reset(); load();
  }

  if (loading) return <PageSkeleton />;
  if (!client) return <div className="card">Client not found. <Link to="/clients">Back to clients</Link></div>;

  return (
    <div className="card">
      <div className="row">
        <h2>{client.name} <small>{label(client.type)} · </small><Badge v={client.status} /></h2>
        {canWrite && (
          <span>
            <select aria-label="Client status" value={client.status} onChange={(e) => setStatus(e.target.value)}>{CLIENT_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
            {client.status === 'archived' && <button onClick={() => setStatus('active')}>Restore</button>}
          </span>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      <Tabs prefix="client" label="Client sections" tabs={['overview', 'contacts', 'projects', 'tasks', 'documents', 'notes', 'activity'] as const} value={tab} onChange={setTab} />
      <div {...panelProps('client', tab)}>

      {tab === 'overview' && (editing ? (
        <form className="grid" onSubmit={saveClient}>
          <label>Name<input name="name" defaultValue={client.name} required maxLength={200} /></label>
          <label>Type<select name="type" defaultValue={client.type}><option value="business">Business</option><option value="individual">Individual</option></select></label>
          <label>Email<input name="email" type="email" defaultValue={client.email ?? ''} /></label>
          <label>Phone<input name="phone" defaultValue={client.phone ?? ''} /></label>
          <label>Industry<input name="industry" defaultValue={client.industry ?? ''} /></label>
          <label>Website<input name="website" type="url" placeholder="https://" defaultValue={client.website ?? ''} /></label>
          <label>Source<input name="source" defaultValue={client.source ?? ''} /></label>
          <label>Tags (comma separated)<input name="tags" defaultValue={(client.tags ?? []).join(', ')} /></label>
          <label>Address<textarea name="address" rows={2} defaultValue={client.address ?? ''} /></label>
          <span className="row filters"><button type="submit">Save changes</button><button type="button" className="link" onClick={() => setEditing(false)}>Cancel</button></span>
        </form>
      ) : (<>
        <dl>
          <dt>Email</dt><dd>{client.email ?? '—'}</dd>
          <dt>Phone</dt><dd>{client.phone ?? '—'}</dd>
          <dt>Industry</dt><dd>{client.industry ?? '—'}</dd>
          <dt>Website</dt><dd>{client.website ? <a href={client.website} target="_blank" rel="noopener noreferrer">{client.website}</a> : '—'}</dd>
          <dt>Address</dt><dd>{client.address ?? '—'}</dd>
          <dt>Source</dt><dd>{client.source ?? '—'}</dd>
          <dt>Tags</dt><dd>{client.tags?.length ? client.tags.join(', ') : '—'}</dd>
          <dt>Created</dt><dd>{new Date(client.created_at).toLocaleDateString()}</dd>
        </dl>
        {canWrite && <button className="pill-btn ghost" onClick={() => setEditing(true)}>Edit details</button>}
      </>))}

      {tab === 'contacts' && (
        <>
          {contacts.length === 0 ? <p>No contacts yet.</p> : (
            <table><thead><tr><th>Name</th><th>Title</th><th>Email</th><th>Phone</th><th>Flags</th></tr></thead>
              <tbody>{contacts.map((c) => (
                <tr key={c.id}><td>{c.full_name}</td><td>{c.job_title}</td><td>{c.email}</td><td>{c.phone}</td>
                  <td>{[c.is_primary && 'primary', c.can_approve && 'approver'].filter(Boolean).join(', ')}</td></tr>
              ))}</tbody></table>
          )}
          {canWrite && (
            <form className="grid" onSubmit={addContact}>
              <label>Full name<input name="full_name" required /></label>
              <label>Job title<input name="job_title" /></label>
              <label>Email<input name="email" type="email" /></label>
              <label>Phone<input name="phone" /></label>
              <label><span><input type="checkbox" name="is_primary" /> Primary</span></label>
              <label><span><input type="checkbox" name="can_approve" /> Can approve</span></label>
              <button type="submit">Add contact</button>
            </form>
          )}
        </>
      )}

      {tab === 'projects' && (projs.length === 0 ? <p>No projects for this client.</p> : <ul className="plain">{projs.map((x) => <li key={x.id}><Link to={`/projects/${x.id}`}>{x.name}</Link> <Badge v={x.status} /></li>)}</ul>)}
      {tab === 'tasks' && (<>
        {can(membership!.role, 'task:write') && <p><Link to={`/tasks?client=${id}`}>View all tasks</Link> · <Link to={`/tasks?client=${id}&new=1`}>New task for this client</Link></p>}
        {tks.length === 0 ? <p>No tasks for this client.</p> : <ul className="plain">{tks.map((x) => <li key={x.id}><Link to={`/tasks/${x.id}`}>{x.title}</Link> <Badge v={x.status} /></li>)}</ul>}</>)}
      {tab === 'documents' && <FilePanel orgId={orgId} userId={uid} entityType="client" entityId={id!} canUpload={canWrite} canDelete={canWrite} />}

      {tab === 'notes' && (
        <>
          {canWrite && (
            <form onSubmit={addNote} className="grid">
              <label>Internal note<textarea name="body" required rows={3} /></label>
              <button type="submit">Add note</button>
            </form>
          )}
          {notes.length === 0 ? <p>No notes yet.</p> : notes.map((n) => (
            <p key={n.id} className="note">{n.body}<br /><small>{new Date(n.created_at).toLocaleString()}</small></p>
          ))}
        </>
      )}

      {tab === 'activity' && (activity.length === 0 ? <p>No activity yet.</p> : (
        <ul>{activity.map((a) => <li key={a.id}>{a.action.replace('_', ' ')} — {new Date(a.created_at).toLocaleString()}</li>)}</ul>
      ))}
      </div>
    </div>
  );
}
