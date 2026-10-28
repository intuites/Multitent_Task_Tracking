import { useState, type FormEvent, type ReactNode } from 'react';
import { AlertCircle, Check, CheckCircle2, Eye, EyeOff, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LiquidBg } from '../components/Liquid';

type Msg = { kind: 'error' | 'ok'; text: string; n: number } | null;

// Supabase's wording is terse; say what happened and what to do next.
const friendly = (m: string) =>
  /invalid login credentials/i.test(m) ? "That email and password don't match. Check them and try again."
  : /email not confirmed/i.test(m) ? 'Confirm your email first. The link is in your inbox.'
  : /already registered/i.test(m) ? 'An account with this email already exists. Sign in instead.'
  : /rate limit|too many/i.test(m) ? 'Too many attempts. Wait a minute, then try again.'
  : m;

export default function Login() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsgState] = useState<Msg>(null);
  // n changes on every message so a repeated error replays its animation
  const setMsg = (kind: 'error' | 'ok', text: string) => setMsgState((p) => ({ kind, text, n: (p?.n ?? 0) + 1 }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setMsg('error', friendly(error.message)); else setMsgState(null);
        return;
      }
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
      if (error) setMsg('error', friendly(error.message));
      else if (!data.session) setMsg('ok', 'Check your email to confirm your account, then sign in.');
    } finally { setBusy(false); }
  }
  async function reset() {
    if (!email) return setMsg('error', 'Enter your email above first, then choose Forgot password.');
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if (error) setMsg('error', friendly(error.message)); else setMsg('ok', `Reset link sent to ${email}.`);
  }
  const switchMode = () => { setMode(mode === 'in' ? 'up' : 'in'); setMsgState(null); };
  const bad = msg?.kind === 'error';

  return (
    <AuthLayout>
    <form className={bad ? `login shake-${msg!.n % 2}` : 'login'} onSubmit={submit}>
      <div key={mode} className="auth-swap">
        <h1>{mode === 'in' ? 'Welcome back' : 'Create your account'}</h1>
        <p className="muted auth-sub">{mode === 'in' ? 'Sign in to your workspace.' : 'Set up your account, then create or join an organization.'}</p>
        {mode === 'up' && <label>Full name<input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></label>}
      </div>
      <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" aria-invalid={bad || undefined} /></label>
      <div className="field">
        <div className="field-head">
          <label htmlFor="auth-pw">Password</label>
          {mode === 'in' && <button type="button" className="link" onClick={reset}>Forgot password?</button>}
        </div>
        <span className="pw">
          <input id="auth-pw" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8}
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'} aria-invalid={bad || undefined} />
          <button type="button" className="pw-eye" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
            {show ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
          </button>
        </span>
      </div>
      {msg && (
        <p key={msg.n} role={bad ? 'alert' : 'status'} className={`auth-msg ${msg.kind}`}>
          {bad ? <AlertCircle size={18} aria-hidden="true" /> : <CheckCircle2 size={18} aria-hidden="true" />}<span>{msg.text}</span>
        </p>
      )}
      <button type="submit" className="auth-submit" disabled={busy} aria-busy={busy}>
        {busy && <Loader2 size={17} className="spin" aria-hidden="true" />}
        {busy ? (mode === 'in' ? 'Signing in…' : 'Creating account…') : mode === 'in' ? 'Sign in' : 'Create account'}
      </button>
      <div className="auth-links">
        <button type="button" className="link" onClick={switchMode}>{mode === 'in' ? 'New here? Create an account' : 'Have an account? Sign in'}</button>
      </div>
    </form>
    </AuthLayout>
  );
}

// Shared shell for sign-in, password setup and onboarding: brand panel left, content right.
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-art">
        <LiquidBg tone="deep" />
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
