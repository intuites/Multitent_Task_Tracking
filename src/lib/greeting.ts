// The top bar's greeting follows the organization's time zone (Organization settings), not the viewer's computer.

/** The zone if the browser knows it, else the viewer's own zone. */
export function safeZone(zone?: string | null) {
  if (zone) try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return zone; } catch { /* unknown zone */ }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Today's date (YYYY-MM-DD) in `zone`, so the Calendar and date pickers agree with the top bar. */
export const todayIn = (zone?: string | null) => new Date().toLocaleDateString('en-CA', { timeZone: safeZone(zone) });
let openZone: string | undefined; // the open organization's zone, set by lib/auth
export const setOrgZone = (z?: string | null) => { openZone = z ?? undefined; };
export const orgToday = () => todayIn(openZone);

/** Morning 5–11, afternoon 12–16, evening 17–20, night 21–4, in `zone`. */
export function greeting(d: Date, zone: string) {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(d));
  return h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 17 ? 'Good afternoon' : h >= 17 && h < 21 ? 'Good evening' : 'Good night';
}
