import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Mail, Plus, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ask } from './Dialog';

export interface ExtraEmail { user_id: string; email: string; label: string | null }

/** Extra addresses of these people in an organization (empty before migration 0035, or for addresses you may not see). */
export async function loadEmails(orgId: string, userIds: string[]): Promise<Map<string, ExtraEmail[]>> {
  const out = new Map<string, ExtraEmail[]>();
  if (!userIds.length) return out;
  const { data } = await supabase.from('tt_member_emails').select('user_id, email, label').eq('org_id', orgId).in('user_id', userIds).order('created_at');
  for (const r of (data ?? []) as ExtraEmail[]) out.set(r.user_id, [...(out.get(r.user_id) ?? []), r]);
  return out;
}

/** "Priya (work)" style option text for an address. */
export const emailText = (e: { email: string; label: string | null }) => (e.label ? `${e.email} (${e.label})` : e.email);

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const friendly = (m: string, code?: string) =>
  code === '23505' || /duplicate|unique/i.test(m) ? 'That address is already added in this organization.'
  : /relation|schema cache|does not exist/i.test(m) ? 'Extra addresses need the database update (migration 0035) first.'
  : m;

/** A person's primary (sign-in) address and their extra addresses in this organization, with add and remove. */
export function MemberEmails({ orgId, userId, primary, canEdit, onChange }: { orgId: string; userId: string; primary: string; canEdit: boolean; onChange?: () => void }) {
  const [rows, setRows] = useState<(ExtraEmail & { id: string })[]>([]);
  const [missing, setMissing] = useState(false);
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('tt_member_emails').select('id, user_id, email, label').eq('org_id', orgId).eq('user_id', userId).order('created_at');
    setMissing(!!error); setRows((data ?? []) as any);
  }, [orgId, userId]);
  useEffect(() => { load(); }, [load]);

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget, f = new FormData(form);
    const email = String(f.get('email') ?? '').trim().toLowerCase(), label = String(f.get('label') ?? '').trim();
    if (!EMAIL.test(email)) return setErr(`“${email}” isn’t a valid email address.`);
    if (email === primary.toLowerCase()) return setErr('That is already the primary address.');
    setBusy(true); setErr('');
    const { error } = await supabase.from('tt_member_emails').insert({ org_id: orgId, user_id: userId, email, label: label || null });
    setBusy(false);
    if (error) return setErr(friendly(error.message, error.code));
    form.reset(); load(); onChange?.();
  }
  async function remove(r: { id: string; email: string }) {
    if (!(await ask({ title: `Remove ${r.email}?`, message: 'Tasks that email this address go back to the primary address.', confirmLabel: 'Remove address', danger: true })).ok) return;
    const { error } = await supabase.from('tt_member_emails').delete().eq('id', r.id);
    if (error) return setErr(friendly(error.message, error.code));
    load(); onChange?.();
  }

  return (
    <div className="me-list">
      <ul className="people">
        <li><Mail size={15} aria-hidden="true" /><span className="grow"><b>{primary}</b><br /><small className="muted">Used to sign in</small></span><span className="prio prio-low">Primary</span></li>
        {rows.map((r) => (
          <li key={r.id}><Mail size={15} aria-hidden="true" /><span className="grow"><b>{r.email}</b>{r.label && <><br /><small className="muted">{r.label}</small></>}</span>
            {canEdit && <button type="button" className="icon-btn sm" aria-label={`Remove ${r.email}`} onClick={() => remove(r)}><X size={14} aria-hidden="true" /></button>}</li>))}
      </ul>
      {missing ? <p className="muted">Extra addresses need the database update (migration 0035) first.</p>
        : canEdit && (
          <form className="me-add" onSubmit={add}>
            <input name="email" type="email" required placeholder="another@company.com" aria-label="Extra email address" maxLength={254} />
            <input name="label" placeholder="Label, e.g. Work" aria-label="Label (optional)" maxLength={40} />
            <button type="submit" className="pill-btn ghost" disabled={busy}><Plus size={15} aria-hidden="true" />Add address</button>
          </form>)}
      {err && <p role="alert" className="form-alert">{err}</p>}
    </div>
  );
}
