import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { BellRing, FileSpreadsheet, ShieldCheck, AlertCircle, ArrowBigUp, ArrowLeft, ArrowRight, Check, CheckCircle2, Eye, EyeOff, Loader2, LockKeyhole, Mail, MailCheck, UserRound } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ThemeToggle, initials } from '../components/Frame';
import Captcha, { captchaOn } from '../components/Captcha';
import { applyLook } from '../lib/theme';
import { firstName, forgetLastUser, readLastUser, saveLastUser } from '../lib/lastUser';
import { strength } from '../lib/password';
import AuthDemo from '../components/AuthDemo';
import './auth.css';

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
const TICK = 'Tick “I’m not a robot” first.';
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise((r) => setTimeout(r, calm() ? 0 : ms));

/** Runs a state change as a shared-element morph (View Transitions) where the browser supports it and motion is welcome;
 *  elsewhere the change simply happens. The .vt class pauses CSS transitions the morph already covers. */
function morph(update: () => void) {
  const d = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
  if (!d.startViewTransition || calm()) return update();
  const root = document.documentElement;
  root.classList.add('vt');
  d.startViewTransition(() => flushSync(update)).finished.finally(() => root.classList.remove('vt'));
}

export default function Login() {
  // whoever last signed in on this device: greeted by name, in their own colours (lib/auth applies the look)
  const [known, setKnown] = useState(() => { const u = readLastUser(); return u?.login ? u : null; });
  const [mode, setMode] = useState<Mode>('in');
  const [email, setEmail] = useState(known?.login ?? '');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [sentTo, setSentTo] = useState('');
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
        const { error, data } = await post('/api/login', { username: email, password, captcha });
        if (error) return setMsg('error', friendly(error.message));
        setMsgState(null);
        saveLastUser({ login: email.trim() });
        setDone(true); // the button turns into a tick and the card lifts away before the workspace opens
        await wait(650);
        const r = await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
        if (r.error) { setDone(false); setMsg('error', friendly(r.error.message)); }
        return;
      }
      const { error } = await post('/api/signup', { full_name: name, email, password, captcha });
      if (error) setMsg('error', friendly(error.message));
      else morph(() => { setSentTo(email); setMsgState(null); });
    } finally { setBusy(false); setUsed((n) => n + 1); } // each answer works once
  }
  async function reset() {
    if (!email.includes('@')) return setMsg('error', known ? 'Choose “Not you?”, enter your email, then Forgot password.' : 'Enter your email above (not your username), then choose Forgot password.');
    if (captchaOn && !captcha) return setMsg('error', TICK);
    const { error } = await post('/api/reset', { email, captcha });
    setUsed((n) => n + 1);
    if (error) setMsg('error', friendly(error.message)); else setMsg('ok', `If ${email} has an account, a reset link is on its way.`);
  }
  const switchTo = (m: Mode) => {
    if (m === mode && !sentTo) return;
    // a remembered person's sign-in name is no use as a new account's email
    morph(() => { setMode(m); setMsgState(null); setSentTo(''); if (known) setEmail(m === 'in' ? known.login ?? '' : ''); });
  };
  function notYou() {
    forgetLastUser(); applyLook(null, {}); // back to Taskify's own look
    morph(() => { setKnown(null); setEmail(''); setPassword(''); setMsgState(null); });
  }
  const capsKey = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState('CapsLock'));
  const bad = msg?.kind === 'error';
  const badField = bad && msg!.text !== TICK; // the robot box missing isn't the email or password's fault
  const signIn = mode === 'in';
  const greet = signIn && known;
  const strong = strength(password);

  // after sign-up: the card becomes a "check your inbox" note
  if (sentTo) return (
    <AuthLayout showcase>
      <div className="login auth-sent" role="status">
        <span className="auth-sent-ico" aria-hidden="true"><MailCheck size={30} /></span>
        <h1 className="auth-title">Check your inbox</h1>
        <p className="muted auth-sub">We sent a confirmation link to <b>{sentTo}</b>. Open it to finish creating your account, then sign in.</p>
        <button type="button" className="auth-submit" onClick={() => switchTo('in')}><ArrowLeft size={17} aria-hidden="true" />Back to sign in</button>
        <p className="auth-switch">Wrong address? <button type="button" className="link" onClick={() => morph(() => setSentTo(''))}>Change it</button></p>
      </div>
    </AuthLayout>
  );

  return (
    <AuthLayout showcase>
      <form className={`login${bad ? ` shake-${msg!.n % 2}` : ''}${done ? ' auth-done' : ''}`} onSubmit={submit}>
        <div className="auth-seg" role="group" aria-label="Sign in or create an account" data-mode={mode}>
          <span className="auth-seg-pill" aria-hidden="true" />
          <button type="button" aria-pressed={signIn} onClick={() => switchTo('in')}>Sign in</button>
          <button type="button" aria-pressed={!signIn} onClick={() => switchTo('up')}>Create account</button>
        </div>
        <div className="auth-intro">
          <h1 className="auth-title">{greet ? `Welcome back${firstName(known.name) ? `, ${firstName(known.name)}` : ''}` : signIn ? 'Welcome back' : 'Create your account'}</h1>
          <p className="muted auth-sub">{greet && known.org ? `Sign in to continue to ${known.org}.` : signIn ? 'Sign in to your organization’s workspace.' : 'Then create your organization or join your team’s.'}</p>
        </div>
        {!signIn && (
          <label className="auth-name">Full name
            <span className="ifield"><UserRound size={17} aria-hidden="true" /><input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" placeholder="Priya Sharma" /></span>
          </label>)}
        {greet ? (
          <div className="auth-who">
            <span className="auth-who-av" aria-hidden="true">
              {known.photo ? <img src={known.photo} alt="" onError={(e) => { e.currentTarget.remove(); }} /> : null}{initials(known.name || known.login!)}
            </span>
            <span className="auth-who-text"><b>{known.name || known.login}</b>
              <small><span>{known.login}</span><button type="button" className="link" onClick={notYou}>Not you?</button></small></span>
          </div>
        ) : (
          <label className="auth-email">{signIn ? 'Email or username' : 'Work email'}
            <span className="ifield"><Mail size={17} aria-hidden="true" />
              {signIn
                ? <input value={email} onChange={(e) => setEmail(e.target.value.trim())} required autoComplete="username" autoCapitalize="none" spellCheck={false} aria-invalid={badField || undefined} placeholder="you@company.com" />
                : <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" aria-invalid={badField || undefined} placeholder="you@company.com" />}
            </span>
          </label>)}
        <div className="field auth-pass">
          <div className="field-head">
            <label htmlFor="auth-pw">Password</label>
            {signIn && <button type="button" className="link" onClick={reset}>Forgot password?</button>}
          </div>
          <span className="pw ifield"><LockKeyhole size={17} aria-hidden="true" />
            <input id="auth-pw" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8}
              autoComplete={signIn ? 'current-password' : 'new-password'} aria-invalid={badField || undefined} aria-describedby={signIn ? undefined : 'pw-rule'}
              placeholder={signIn ? 'Your password' : 'At least 8 characters'} autoFocus={!!greet} onKeyDown={capsKey} onKeyUp={capsKey} onBlur={() => setCaps(false)} />
            <button type="button" className="pw-eye" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
              {show ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
            </button>
          </span>
          {caps && <small className="auth-caps" role="status"><ArrowBigUp size={14} aria-hidden="true" />Caps Lock is on</small>}
          {!signIn && <small id="pw-rule" className="sr-only">At least 8 characters.</small>}
          {!signIn && password && <div className={`pw-meter s${strong.score}`} aria-live="polite"><span><i /><i /><i /><i /><i /></span><small>{strong.text}</small></div>}
        </div>
        <Captcha onToken={setCaptcha} reset={used} />
        {msg && (
          <p key={msg.n} role={bad ? 'alert' : 'status'} className={`auth-msg ${msg.kind}`}>
            {bad ? <AlertCircle size={18} aria-hidden="true" /> : <CheckCircle2 size={18} aria-hidden="true" />}<span>{msg.text}</span>
          </p>
        )}
        <button type="submit" className="auth-submit" disabled={busy || done} aria-busy={busy}>
          {done ? <><Check size={18} className="auth-tick" aria-hidden="true" />Signed in</>
            : <>{busy && <Loader2 size={17} className="spin" aria-hidden="true" />}
              {busy ? (signIn ? 'Signing in…' : 'Creating account…') : signIn ? 'Sign in' : 'Create account'}
              {!busy && <ArrowRight size={17} className="auth-go" aria-hidden="true" />}</>}
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
export function AuthLayout({ children, showcase = false }: { children: ReactNode; showcase?: boolean }) {
  return (
    <div className={showcase ? 'auth split' : 'auth'}>
      <div className="auth-glow" aria-hidden="true"><i /><i /></div>
      {showcase && (
        <aside className="auth-show" aria-label="About Taskify">
          <span className="auth-show-brand"><span className="mark" aria-hidden="true">T</span>Taskify</span>
          <div>
            <h2>Every task, every team, on time.</h2>
            <p>Assign work to departments and people, follow every status, and let reminders keep it moving.</p>
          </div>
          <div className="auth-show-demo" aria-hidden="true"><AuthDemo /></div>
          <ul>
            <li><BellRing size={16} aria-hidden="true" />Email reminders</li>
            <li><ShieldCheck size={16} aria-hidden="true" />Each organization sees only its own data</li>
            <li><FileSpreadsheet size={16} aria-hidden="true" />Excel and PDF reports</li>
          </ul>
        </aside>
      )}
      <div className="auth-top">
        <a href="/guide" className="pill-btn ghost">How Taskify works</a>
        <ThemeToggle />
      </div>
      <main className="auth-body">
        <div className="auth-stack">
          <div className="auth-logo"><span className="mark" aria-hidden="true">T</span><b>Taskify</b></div>
          {children}
        </div>
      </main>
      <p className="auth-foot">Each organization sees only its own data.</p>
    </div>
  );
}
