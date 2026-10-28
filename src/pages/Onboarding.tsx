import { useState, type FormEvent } from 'react';
import { rpc } from '../lib/ui';
import { useAuth } from '../lib/auth';
import { AuthLayout } from './Login';

// Shown to a signed-in user who belongs to no organization and is not a portal contact.
// Most people here are employees waiting for an invite, so that path comes first.
export default function Onboarding() {
  const { session, refresh, signOut } = useAuth();
  const [creating, setCreating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await rpc('tt_create_organization', { p_name: f.get('name'), p_slug: String(f.get('slug')).toLowerCase(), p_tz: f.get('tz') });
      refresh();
    } catch (x) { setErr((x as Error).message); }
  }
  function checkAgain() {
    setChecking(true);
    refresh();
    setTimeout(() => setChecking(false), 1500);
  }

  return (
    <AuthLayout>
      {!creating ? (
        <div className="login">
          <h1>You're not in a workspace yet</h1>
          <p className="muted auth-sub">
            If your company already uses Taskify, ask your admin to invite <b>{session?.user.email}</b> from <b>Employees &amp; Teams</b>.
            Once they have, check again.
          </p>
          <button type="button" onClick={checkAgain} disabled={checking}>{checking ? 'Checking…' : 'Check again'}</button>
          <p className="auth-or"><span>or</span></p>
          <button type="button" className="pill-btn ghost" onClick={() => setCreating(true)}>Create a new organization</button>
          <button type="button" className="link" onClick={signOut}>Sign out</button>
        </div>
      ) : (
        <form className="login" onSubmit={submit}>
          <h1>Create your organization</h1>
          <p className="muted auth-sub">You will be its owner and can invite your team afterwards.</p>
          <label>Organization name<input name="name" required maxLength={120} /></label>
          <label>URL slug<input name="slug" required pattern="[a-z0-9][a-z0-9-]{1,40}" placeholder="my-company" /></label>
          <label>Time zone<input name="tz" defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone} required /></label>
          {err && <p role="alert">{err}</p>}
          <button type="submit">Create organization</button>
          <button type="button" className="link" onClick={() => { setCreating(false); setErr(''); }}>Back</button>
        </form>
      )}
    </AuthLayout>
  );
}
