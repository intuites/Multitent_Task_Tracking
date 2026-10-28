import { useState, type FormEvent } from 'react';
import { rpc } from '../lib/ui';
import { useAuth } from '../lib/auth';

// Shown to a signed-in user who belongs to no organization and is not a portal contact.
export default function Onboarding() {
  const { refresh, signOut } = useAuth();
  const [err, setErr] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await rpc('tt_create_organization', { p_name: f.get('name'), p_slug: String(f.get('slug')).toLowerCase(), p_tz: f.get('tz') });
      refresh();
    } catch (x) { setErr((x as Error).message); }
  }
  return (
    <form className="card login" onSubmit={submit}>
      <h1>Set up your organization</h1>
      <p>You are not a member of any organization yet. Create one, or ask an admin to invite you.</p>
      <label>Organization name<input name="name" required maxLength={120} /></label>
      <label>URL slug<input name="slug" required pattern="[a-z0-9][a-z0-9-]{1,40}" placeholder="my-company" /></label>
      <label>Time zone<input name="tz" defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone} required /></label>
      {err && <p role="alert">{err}</p>}
      <button type="submit">Create organization</button>
      <button type="button" className="link" onClick={signOut}>Sign out</button>
    </form>
  );
}
