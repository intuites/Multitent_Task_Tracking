import { useState, type FormEvent } from 'react';
import { Building2 } from 'lucide-react';
import { rpc } from '../lib/ui';
import { useAuth } from '../lib/auth';

// Create another organization from inside the app. A platform admin's is ready at once; others wait for approval.
export default function NewOrg() {
  const { switchOrg, memberships, platformAdmin, requests, refresh } = useAuth();
  const [sent, setSent] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setErr('');
    try {
      const id = await rpc<string>('tt_create_organization', { p_name: name.trim(), p_slug: String(f.get('slug')).toLowerCase(), p_tz: f.get('tz') });
      // a platform admin's organization is ready now; everyone else's waits for a platform admin
      if (platformAdmin) return switchOrg(id);
      setSent(name.trim()); setName(''); setBusy(false); refresh();
    } catch (x) { setErr((x as Error).message); setBusy(false); }
  }

  // admins can start another organization (they become its admin); platform admins create it without joining
  if (!memberships.some((m) => m.role === 'owner' || m.role === 'admin')) return <div className="card rp-empty"><Building2 size={28} aria-hidden="true" /><p>Only admins can create a new organization.</p></div>;
  return (
    <>
      <div className="page-head"><div><h2 className="page-title">Create organization</h2><p className="page-sub">{platformAdmin ? 'It’s ready straight away. Switch between organizations from the name at the top of the sidebar.' : 'You’ll be its admin. A Taskify admin approves new organizations within 24 hours.'}</p></div></div>
      {sent && <p role="status" className="auth-msg ok"><span><b>{sent}</b> was sent for approval. It will be approved within 24 hours; please wait. We'll email you when it's ready.</span></p>}
      {requests.length > 0 && (
        <section className="card" aria-labelledby="req-h">
          <h3 id="req-h">Your requests</h3>
          <ul className="help-list">{requests.map((r) => (
            <li key={r.id}><span className="grow"><b>{r.name}</b></span>
              <small className={r.status === 'rejected' ? 'danger-text' : 'muted'}>{r.status === 'pending' ? 'Waiting for approval (within 24 hours)' : 'Not approved'}</small></li>))}</ul>
        </section>
      )}
      <section className="card neworg">
        <span className="pf-role-ico"><Building2 size={22} aria-hidden="true" /></span>
        <form className="pf-form" onSubmit={submit}>
          <label className="pf-wide">Organization name<input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="Acme Inc." /></label>
          <label>URL slug<input name="slug" key={slug} defaultValue={slug} required pattern="[a-z0-9][a-z0-9-]{1,40}" /></label>
          <label>Time zone<input name="tz" defaultValue="America/New_York" required /></label>
          {err && <p role="alert" className="form-alert pf-wide">{err}</p>}
          <div className="pf-wide pf-actions"><button type="submit" disabled={busy}>{busy ? 'Sending…' : platformAdmin ? 'Create organization' : 'Send for approval'}</button></div>
        </form>
      </section>
    </>
  );
}
