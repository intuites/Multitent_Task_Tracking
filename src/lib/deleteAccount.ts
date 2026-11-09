import { supabase } from './supabase';
import { ask } from '../components/Dialog';

/** Platform admins (anyone) and organization admins (their own employees): deletes someone's account and everything that is theirs, after they type the email to confirm.
 *  Resolves true when deleted, false when cancelled; throws with a readable message when it fails. */
export async function deleteAccount(p: { id: string; name: string; email: string }): Promise<boolean> {
  const r = await ask({
    title: `Delete ${p.name}'s account?`,
    message: `This can't be undone. ${p.name} can no longer sign in, and is removed from every organization. Their comments, assignments and history entries are deleted; tasks and files they created stay.`,
    input: `Type ${p.email} to confirm`, confirmLabel: 'Delete account', danger: true,
  });
  if (!r.ok) return false;
  if (r.value.trim().toLowerCase() !== p.email.toLowerCase()) throw new Error('The email didn\'t match, so nothing was deleted.');
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  const res = await fetch('/api/delete-user', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ user_id: p.id }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? `Couldn't delete the account (${res.status})`);
  return true;
}
