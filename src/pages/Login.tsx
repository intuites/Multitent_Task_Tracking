import { useState, type FormEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, Loader2, LockKeyhole, Mail, UserRound } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ThemeToggle } from '../components/Frame';
import Captcha, { captchaOn } from '../components/Captcha';

type Msg = { kind: 'error' | 'ok'; text: string; n: number } | null;
type Mode = 'in' | 'up';

// Supabase's wording is terse; say what happened and what to do next.
const friendly = (m: string) =>
  /invalid login credentials/i.test(m) ? "That email and password don't match. Check them and try again."
  : /email not confirmed/i.test(m) ? 'Confirm your email first. The link is in your inbox.'
  : /already registered/i.test(m) ? 'An account with this email already exists. Sign in instead.'
  : /rate limit|too many/i.test(m) ? 'Too many attempts. Wait a minute, then try again.'
  // 504 here is Supabase's mail server (SMTP) not answering, so no email went out
  : /50[234]|timeout|sending .*email/i.test(m) ? "We couldn't send the email right now. Try again in a minute, or contact your admin."
  : m;

/** Sign-in, sign-up and password reset all go through Taskify's server, which checks the robot box first. */
async function post(path: string, body: object): Promise<{ error: { message: string } | null; data?: any }> {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { error: null, data: j } : { error: { message: j.error || 'Something went wrong. Try again.' } };
  } catch { return { error: { message: "Couldn't reach Taskify. Check your connection and try again." } }; }
}
async function serverSignIn(username: string, password: string, captcha: string) {
  const { error, data } = await post('/api/login', { username, password, captcha });
  return error ? { error } : await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
}
const TICK = 'Tick “I’m not a robot” first.';

/** Runs a state change as a shared-element morph (View Transitions) where the browser supports it and motion is welcome;
 *  elsewhere the change simply happens. The .vt class pauses CSS transitions the morph already covers. */
function morph(update: () => void) {
  const d = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
  if (!d.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return update();
  const root = document.documentElement;
  root.classList.add('vt');
  d.startViewTransition(() => flushSync(update)).finished.finally(() => root.classList.remove('vt'));
}

export default function Login() {
  const [mode, setMode] = useState<Mode>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsgState] = useState<Msg>(null);
  const [captcha, setCaptcha] = useState(''), [used, setUsed] = useState(0);
  // n changes on every message so a repeated error replays its animation
  const setMsg = (kind: 'error' | 'ok', text: string) => setMsgState((p) => ({ kind, text, n: (p?.n ?? 0) + 1 }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (captchaOn && !captcha) return setMsg('error', TICK);
    setBusy(true);
    try {
      if (mode === 'in') {
        // an email or a username: the server finds the account, so a username's email is never shown here
        const { error } = await serverSignIn(email, password, captcha);
        if (error) setMsg('error', friendly(error.message)); else setMsgState(null);
        return;
      }
      const { error } = await post('/api/signup', { full_name: name, email, password, captcha });
      if (error) setMsg('error', friendly(error.message));
      else setMsg('ok', 'Check your email to confirm your account, then sign in.');
    } finally { setBusy(false); setUsed((n) => n + 1); } // each answer works once
  }
  async function reset() {
    if (!email.includes('@')) return setMsg('error', 'Enter your email above (not your username), then choose Forgot password.');
    if (captchaOn && !captcha) return setMsg('error', TICK);
    const { error } = await post('/api/reset', { email, captcha });
    setUsed((n) => n + 1);
    if (error) setMsg('error', friendly(error.message)); else setMsg('ok', `If ${email} has an account, a reset link is on its way.`);
  }
  const switchTo = (m: Mode) => { if (m !== mode) morph(() => { setMode(m); setMsgState(null); }); };
  const bad = msg?.kind === 'error';
  const badField = bad && msg!.text !== TICK; // the robot box missing isn't the email or password's fault
  const signIn = mode === 'in';

  return (
    <AuthLayout>
      <form className={bad ? `login shake-${msg!.n % 2}` : 'login'} onSubmit={submit}>
        <div className="auth-seg" role="group" aria-label="Sign in or create an account" data-mode={mode}>
          <span className="auth-seg-pill" aria-hidden="true" />
          <button type="button" aria-pressed={signIn} onClick={() => switchTo('in')}>Sign in</button>
          <button type="button" aria-pressed={!signIn} onClick={() => switchTo('up')}>Create account</button>
        </div>
        <div className="auth-intro">
          <h1 className="auth-title">{signIn ? 'Welcome back' : 'Create your account'}</h1>
          <p className="muted auth-sub">{signIn ? 'Sign in to your organization’s workspace.' : 'Then create your organization or join your team’s.'}</p>
        </div>
        {!signIn && (
          <label className="auth-name">Full name
            <span className="ifield"><UserRound size={17} aria-hidden="true" /><input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" placeholder="Priya Sharma" /></span>
          </label>)}
        <label className="auth-email">{signIn ? 'Email or username' : 'Work email'}
          <span className="ifield"><Mail size={17} aria-hidden="true" />
            {signIn
              ? <input value={email} onChange={(e) => setEmail(e.target.value.trim())} required autoComplete="username" autoCapitalize="none" spellCheck={false} aria-invalid={badField || undefined} placeholder="you@company.com" />
              : <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" aria-invalid={badField || undefined} placeholder="you@company.com" />}
          </span>
        </label>
        <div className="field auth-pass">
          <div className="field-head">
            <label htmlFor="auth-pw">Password</label>
            {signIn && <button type="button" className="link" onClick={reset}>Forgot password?</button>}
          </div>
          <span className="pw ifield"><LockKeyhole size={17} aria-hidden="true" />
            <input id="auth-pw" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8}
              autoComplete={signIn ? 'current-password' : 'new-password'} aria-invalid={badField || undefined} aria-describedby={signIn ? undefined : 'pw-rule'}
              placeholder={signIn ? 'Your password' : 'At least 8 characters'} />
            <button type="button" className="pw-eye" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
              {show ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
            </button>
          </span>
          {!signIn && <small id="pw-rule" className="sr-only">At least 8 characters.</small>}
        </div>
        <Captcha onToken={setCaptcha} reset={used} />
        {msg && (
          <p key={msg.n} role={bad ? 'alert' : 'status'} className={`auth-msg ${msg.kind}`}>
            {bad ? <AlertCircle size={18} aria-hidden="true" /> : <CheckCircle2 size={18} aria-hidden="true" />}<span>{msg.text}</span>
          </p>
        )}
        <button type="submit" className="auth-submit" disabled={busy} aria-busy={busy}>
          {busy && <Loader2 size={17} className="spin" aria-hidden="true" />}
          {busy ? (signIn ? 'Signing in…' : 'Creating account…') : signIn ? 'Sign in' : 'Create account'}
          {!busy && <ArrowRight size={17} className="auth-go" aria-hidden="true" />}
        </button>
        <p className="auth-switch">
          {signIn ? 'New to Taskify?' : 'Already have an account?'}{' '}
          <button type="button" className="link" onClick={() => switchTo(signIn ? 'up' : 'in')}>{signIn ? 'Create an account' : 'Sign in'}</button>
        </p>
      </form>
    </AuthLayout>
  );
}

// Shared shell for sign-in, password setup, two-factor and onboarding: one centered card on a soft brand-tinted page.
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-glow" aria-hidden="true"><i /><i /></div>
      <div className="auth-top">
        <span className="brand"><span className="mark" aria-hidden="true">T</span><span>Taskify</span></span>
        <span className="auth-corner"><a href="/guide" className="pill-btn ghost">How Taskify works</a><ThemeToggle /></span>
      </div>
      <main className="auth-body">{children}</main>
      <p className="auth-foot">Each organization sees only its own data.</p>
    </div>
  );
}