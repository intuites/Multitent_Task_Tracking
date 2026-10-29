import { useState, type FormEvent } from 'react';
import { Building2 } from 'lucide-react';
import { rpc } from '../lib/ui';
import { useAuth } from '../lib/auth';

// Create another organization from inside the app; the new one becomes active straight away.
export default function NewOrg() {
  const { switchOrg, memberships } = useAuth();
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
      switchOrg(id);
    } catch (x) { setErr((x as Error).message); setBusy(false); }
  }

  // owners invite people; only someone who already owns an organization can start another one
  if (!memberships.some((m) => m.role === 'owner')) return <div className="card rp-empty"><Building2 size={28} aria-hidden="true" /><p>Only organization owners can create a new organization.</p></div>;
  return (
    <>
      <div className="page-head"><div><h2 className="page-title">Create organization</h2><p className="page-sub">You’ll be its owner. Switch between organizations from the name at the top of the sidebar.</p></div></div>
      <section className="card neworg">
        <span className="pf-role-ico"><Building2 size={22} aria-hidden="true" /></span>
        <form className="pf-form" onSubmit={submit}>
          <label className="pf-wide">Organization name<input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="Acme Inc." /></label>
          <label>URL slug<input name="slug" key={slug} defaultValue={slug} required pattern="[a-z0-9][a-z0-9-]{1,40}" /></label>
          <label>Time zone<input name="tz" defaultValue="America/New_York" required /></label>
          {err && <p role="alert" className="form-alert pf-wide">{err}</p>}
          <div className="pf-wide pf-actions"><button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create organization'}</button></div>
        </form>
      </section>
    </>
  );
}
