import { admin, handler, HttpError, type Req } from './_lib/http.js';

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const BAD = 'Invalid login credentials'; // same words as Supabase, so the sign-in page shows its usual message
// shortcut: per-instance memory, so the limit resets on restart and isn't shared between servers; move to the database if abused
const tries = new Map<string, { n: number; at: number }>();
const WINDOW = 10 * 60e3;
const PER_IP = 8;    // one address guessing one username: stops guessing without locking the real person out elsewhere
const PER_USER = 40; // everyone together guessing one username: stops spread-out guessing

const ip = (req: Req) => String(req.headers['x-forwarded-for'] ?? req.headers['x-real-ip'] ?? '').split(',')[0].trim() || 'unknown';
/** Counts one attempt for `key` and says whether it is over `max`. Counted before any slow work, so parallel tries are counted too. */
function over(key: string, max: number) {
  const now = Date.now(), cur = tries.get(key);
  const t = cur && now - cur.at < WINDOW ? cur : { n: 0, at: now };
  t.n++; tries.set(key, t);
  if (tries.size > 10_000) for (const [k, v] of tries) if (now - v.at >= WINDOW) tries.delete(k); // forget old entries
  return t.n > max;
}

// POST { username, password } -> { access_token, refresh_token }. Usernames only: emails sign in from the browser.
// The email behind a username is never sent back, so nobody can look up people's addresses by guessing usernames.
export default handler('POST', async (req) => {
  const { username, password } = req.body ?? {};
  const u = typeof username === 'string' ? username.trim().toLowerCase() : '';
  if (!USERNAME.test(u) || typeof password !== 'string' || !password || password.length > 200) throw new HttpError(400, BAD);
  const byIp = `${u}|${ip(req)}`;
  if (over(byIp, PER_IP) || over(u, PER_USER)) throw new HttpError(429, 'Too many attempts. Wait a few minutes, then try again.');

  const db = admin();
  const { data: p } = await db.from('tt_profiles').select('user_id').eq('username', u).maybeSingle();
  // the login email lives on the auth account; the profile copy is only for display
  const email = p ? (await db.auth.admin.getUserById(p.user_id)).data.user?.email : undefined;
  // Supabase's password sign-in, called directly: no client object (and no session) kept on the server
  const r = email ? await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }) : null;
  const j: any = r ? await r.json().catch(() => ({})) : {};
  // one message for every failure, so it doesn't reveal which usernames exist (unconfirmed only comes with the right password)
  if (!r?.ok || !j.access_token) throw new HttpError(400, /not confirmed/i.test(`${j.error_code} ${j.msg} ${j.error_description}`) ? 'Email not confirmed' : BAD);
  tries.delete(byIp); tries.delete(u);
  return { access_token: j.access_token, refresh_token: j.refresh_token };
});
