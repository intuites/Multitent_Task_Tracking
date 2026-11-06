import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { AuthLayout } from './Login';

/** Set up an authenticator app (QR code) the first time, then check its 6-digit code. onDone runs once the session is two-factor. */
export function TwoFactorForm({ onDone, onCancel, compact }: { onDone: () => void; onCancel?: () => void; compact?: boolean }) {
  const [factorId, setFactorId] = useState('');
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const pending = useRef(''); // a factor made here and not verified yet: removed on cancel

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) return setErr(error.message);
      const ready = data.totp.find((f) => f.status === 'verified');
      if (ready) return setFactorId(ready.id);
      // a half-finished setup from earlier would block a new one
      for (const f of data.all.filter((x) => x.factor_type === 'totp' && x.status !== 'verified')) await supabase.auth.mfa.unenroll({ factorId: f.id });
      const en = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Taskify ${new Date().toISOString().slice(0, 16)}` });
      if (en.error) return setErr(/disabled|not enabled/i.test(en.error.message) ? 'Two-factor sign-in is turned off for this Taskify project. Enable TOTP in Supabase → Authentication → Multi-Factor.' : en.error.message);
      pending.current = en.data.id;
      setFactorId(en.data.id); setSetup({ qr: en.data.totp.qr_code, secret: en.data.totp.secret });
    })();
  }, []);

  async function verify(e: FormEvent) {
    e.preventDefault(); e.stopPropagation();
    setBusy(true); setErr('');
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') });
    setBusy(false);
    if (error) return setErr(/invalid|expired/i.test(error.message) ? "That code didn't work. Codes change every 30 seconds; enter the current one." : error.message);
    pending.current = '';
    onDone();
  }
  async function cancel() {
    if (pending.current) await supabase.auth.mfa.unenroll({ factorId: pending.current });
    onCancel?.();
  }

  // a div, not a form: in settings this sits inside the settings form
  return (
    <div className={compact ? 'tf tf-compact' : 'tf'} onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') verify(e as unknown as FormEvent); }}>
      {setup && (
        <div className="tf-setup">
          <img src={setup.qr} alt="QR code to scan with your authenticator app" width={168} height={168} />
          <p className="muted">Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…), or type the key: <code className="tf-key">{setup.secret}</code></p>
        </div>)}
      <label>6-digit code<input value={code} onChange={(e) => { e.stopPropagation(); setCode(e.target.value); }} inputMode="numeric" autoComplete="one-time-code" maxLength={7} disabled={!factorId} autoFocus={!compact} /></label>
      {err && <p role="alert" className="auth-msg error"><AlertCircle size={18} aria-hidden="true" /><span>{err}</span></p>}
      <div className="tf-actions">
        <button type="button" className={compact ? '' : 'auth-submit'} onClick={(e) => verify(e as unknown as FormEvent)} disabled={busy || !factorId || code.replace(/\s/g, '').length !== 6} aria-busy={busy}>
          {busy ? <Loader2 size={17} className="spin" aria-hidden="true" /> : <ShieldCheck size={17} aria-hidden="true" />}{busy ? 'Checking…' : 'Verify'}
        </button>
        {onCancel && <button type="button" className="pill-btn ghost" onClick={cancel}>Cancel</button>}
      </div>
    </div>
  );
}

/** Shown to admins of an organization that requires two-factor sign-in, before anything else. */
export default function TwoFactor() {
  const { membership, memberships, switchOrg, signOut, mfaDone } = useAuth();
  const other = memberships.find((m) => m.org_id !== membership?.org_id);
  return (
    <AuthLayout>
      <div className="login">
        <h1>Two-factor sign-in</h1>
        <p className="muted auth-sub">{membership?.org_name} asks admins for a code from an authenticator app each time they sign in.</p>
        <TwoFactorForm onDone={mfaDone} />
        <div className="auth-links">
          {other && <button type="button" className="link" onClick={() => switchOrg(other.org_id)}>Open {other.org_name} instead</button>}
          <button type="button" className="link" onClick={signOut}>Sign out</button>
        </div>
      </div>
    </AuthLayout>
  );
}
