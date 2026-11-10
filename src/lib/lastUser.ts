import type { Look } from './theme';

/** The person who last signed in on this device, so the sign-in page can greet them in their own colours.
 *  Kept only in this browser; "Not you?" on the sign-in page forgets it. */
export interface LastUser { name?: string; org?: string; login?: string; look?: Look }
const KEY = 'tt-last-user';

export function readLastUser(): LastUser | null {
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; }
}
export function saveLastUser(part: LastUser) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...readLastUser(), ...part })); } catch { /* storage blocked: no greeting next time */ }
}
export function forgetLastUser() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
export const firstName = (name?: string) => (name ?? '').trim().split(/\s+/)[0] ?? '';
