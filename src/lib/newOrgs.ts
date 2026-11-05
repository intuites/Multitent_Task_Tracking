// "New" organizations for platform admins: added in the last NEW_DAYS days and not yet opened, approved or rejected
// by this platform admin. Remembered per browser (a per-viewer convenience, like the tour).
export const NEW_DAYS = 7;
const KEY = (uid: string) => `tt-orgs-seen:${uid}`;
const EVT = 'tt-orgs-seen';

export function seenOrgs(uid: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(KEY(uid)) || '[]')); } catch { return new Set(); }
}
export function markOrgsSeen(uid: string, ids: string[]) {
  const s = seenOrgs(uid);
  if (ids.every((id) => s.has(id))) return;
  ids.forEach((id) => s.add(id));
  try { localStorage.setItem(KEY(uid), JSON.stringify([...s])); } catch { /* private window: badges come back next visit */ }
  window.dispatchEvent(new Event(EVT));
}
export const isNewOrg = (o: { id: string; created_at: string }, seen: Set<string>, now = Date.now()) =>
  !seen.has(o.id) && now - Date.parse(o.created_at) < NEW_DAYS * 864e5;
/** Re-run `fn` whenever this browser marks organizations as seen (another page, another tab). */
export function onOrgsSeen(fn: () => void) {
  const storage = (e: StorageEvent) => { if (e.key?.startsWith('tt-orgs-seen:')) fn(); };
  window.addEventListener(EVT, fn); window.addEventListener('storage', storage);
  return () => { window.removeEventListener(EVT, fn); window.removeEventListener('storage', storage); };
}
