import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { AlertCircle, Building2, Check, CheckCircle2, Eye, EyeOff, Layers, Loader2, MailCheck, MessageSquare, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Badge } from '../lib/ui';
import { LiquidBg } from '../components/Liquid';
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
    <AuthLayout scene={mode}>
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
        {!signIn && <label className="auth-name">Full name<input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></label>}
        {signIn
          ? <label className="auth-email">Email or username<input value={email} onChange={(e) => setEmail(e.target.value.trim())} required autoComplete="username" autoCapitalize="none" spellCheck={false} aria-invalid={badField || undefined} /></label>
          : <label className="auth-email">Work email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" aria-invalid={badField || undefined} /></label>}
        <div className="field auth-pass">
          <div className="field-head">
            <label htmlFor="auth-pw">Password</label>
            {signIn && <button type="button" className="link" onClick={reset}>Forgot password?</button>}
          </div>
          <span className="pw">
            <input id="auth-pw" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8}
              autoComplete={signIn ? 'current-password' : 'new-password'} aria-invalid={badField || undefined} aria-describedby={signIn ? undefined : 'pw-rule'} />
            <button type="button" className="pw-eye" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
              {show ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
            </button>
          </span>
          {!signIn && <small id="pw-rule" className="muted auth-rule">At least 8 characters.</small>}
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
        </button>
        <p className="auth-switch">
          {signIn ? 'New to Taskify?' : 'Already have an account?'}{' '}
          <button type="button" className="link" onClick={() => switchTo(signIn ? 'up' : 'in')}>{signIn ? 'Create an account' : 'Sign in'}</button>
        </p>
      </form>
    </AuthLayout>
  );
}

const SCENES: Record<Mode, { head: string; lede: string }> = {
  in: { head: 'Pick up right where your team left off.', lede: 'Your tasks, deadlines and updates are waiting.' },
  up: { head: 'Set up your organization in minutes.', lede: 'Add departments, invite your people and start assigning work.' },
};

/** The brand panel's picture of Taskify: today's tasks when signing in, the setup steps when creating an account. */
function Preview({ scene }: { scene: Mode }) {
  if (scene === 'in') return (
    <div className="pv-stage">
      <div className="pv-card">
        <div className="pv-head"><b>My tasks</b><small>Today</small></div>
        <ul className="pv-list">
          <li><span className="pv-text"><b>Design review</b><small>Due today</small></span><Badge v="started" /></li>
          <li><span className="pv-text"><b>QA sign-off</b><small>Due tomorrow</small></span><Badge v="pending" /></li>
          <li><span className="pv-text"><b>Client invoice</b><small>Finished Monday</small></span><Badge v="completed" /></li>
        </ul>
      </div>
      <div className="pv-toast"><MessageSquare size={16} aria-hidden="true" /><span><b>Priya</b> commented on QA sign-off</span></div>
    </div>
  );
  return (
    <div className="pv-stage">
      <div className="pv-card">
        <div className="pv-head"><b>Your organization</b><small>Setup</small></div>
        <ul className="pv-list pv-steps">
          <li><Building2 size={18} aria-hidden="true" /><span className="pv-text"><b>Create your organization</b><small>Name and time zone</small></span><Check size={16} className="pv-done" aria-hidden="true" /></li>
          <li><Layers size={18} aria-hidden="true" /><span className="pv-text"><b>Add departments</b><span className="pv-chips"><i>Finance</i><i>IT</i><i>Sales</i></span></span></li>
          <li><Users size={18} aria-hidden="true" /><span className="pv-text"><b>Invite your team</b><span className="pv-avatars"><i>PK</i><i>AR</i><i>+3</i></span></span></li>
        </ul>
      </div>
      <div className="pv-toast"><MailCheck size={16} aria-hidden="true" /><span>Invitation sent to <b>priya@yourfirm.com</b></span></div>
    </div>
  );
}

// Shared shell for sign-in, password setup, two-factor and onboarding: content left, brand panel with a preview right.
export function AuthLayout({ children, scene = 'in' }: { children: ReactNode; scene?: Mode }) {
  const s = SCENES[scene];
  const first = useRef(scene), moved = useRef(false);
  if (scene !== first.current) moved.current = true;
  return (
    <div className="auth">
      <main className="auth-main">
        <div className="auth-top">
          <span className="brand"><span className="mark" aria-hidden="true">T</span><span>Taskify</span></span>
          <span className="auth-corner"><a href="/guide" className="pill-btn ghost">How Taskify works</a><ThemeToggle /></span>
        </div>
        <div className="auth-body">{children}</div>
        <p className="auth-foot">Each organization sees only its own data.</p>
      </main>
      <aside className={moved.current ? 'auth-art settled' : 'auth-art'} aria-hidden="true">
        <LiquidBg tone="deep" />
        <div className="auth-pane">
          <p className="auth-head">{s.head}</p>
          <p className="auth-lede">{s.lede}</p>
        </div>
        <Preview scene={scene} />
      </aside>
    </div>
  );
}
