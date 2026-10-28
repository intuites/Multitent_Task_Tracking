import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { AuthLayout } from './Login';

// Shown after opening a password-reset or invite email link: the user is signed in but must choose a password.
export default function SetPassword() {
  const { session, passwordSetup, finishPasswordSetup, signOut } = useAuth();
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const invite = passwordSetup === 'invite';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return setMsg('Use at least 8 characters.');
    if (pw !== again) return setMsg('The two passwords do not match.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setMsg(error.message);
    window.history.replaceState(null, '', window.location.pathname); // drop the one-time link tokens from the URL
    finishPasswordSetup();
  }

  return (
    <AuthLayout>
      <form className="login" onSubmit={submit}>
        <h1>{invite ? 'Welcome to Taskify' : 'Set a new password'}</h1>
        <p className="muted auth-sub">
          {invite ? 'Choose a password for ' : 'Choose a new password for '}<b>{session?.user.email}</b>. You will use it to sign in from now on.
        </p>
        <label>New password<input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={8} /></label>
        <label>Confirm password<input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required minLength={8} /></label>
        {msg && <p role="alert">{msg}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : invite ? 'Save password and continue' : 'Update password'}</button>
        <button type="button" className="link" onClick={signOut}>Cancel and sign out</button>
      </form>
    </AuthLayout>
  );
}
