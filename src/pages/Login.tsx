import { useState, type FormEvent, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === 'in') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return setMsg(error ? error.message : '');
    }
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
    if (error) return setMsg(error.message);
    if (!data.session) setMsg('Check your email to confirm your account, then sign in.');
  }
  async function reset() {
    if (!email) return setMsg('Enter your email first.');
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    setMsg(error ? error.message : 'Password reset email sent.');
  }

  return (
    <AuthLayout>
    <form className="login" onSubmit={submit}>
      <h1>{mode === 'in' ? 'Welcome back' : 'Create your account'}</h1>
      <p className="muted auth-sub">{mode === 'in' ? 'Sign in to your workspace.' : 'Set up your account, then create or join an organization.'}</p>
      {mode === 'up' && <label>Full name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>}
      <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></label>
      {msg && <p role="alert">{msg}</p>}
      <button type="submit">{mode === 'in' ? 'Sign in' : 'Sign up'}</button>
      {mode === 'in' && <button type="button" className="link" onClick={reset}>Forgot password?</button>}
      <button type="button" className="link" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg(''); }}>
        {mode === 'in' ? 'New here? Create an account' : 'Have an account? Sign in'}
      </button>
    </form>
    </AuthLayout>
  );
}

// Shared shell for sign-in, password setup and onboarding: brand panel left, content right.
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-art">
        <div className="brand"><span className="mark" aria-hidden="true">T</span><span>Taskify</span></div>
        <div className="auth-copy">
          <p className="auth-head">Client work, tasks and escalations in one place.</p>
          <ul>
            <li><Check size={16} />Every status change is recorded</li>
            <li><Check size={16} />Clients see only what you share with them</li>
            <li><Check size={16} />Escalations stay visible until someone resolves them</li>
          </ul>
        </div>
      </aside>
      <main className="auth-main">{children}</main>
    </div>
  );
}
