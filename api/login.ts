import { createClient } from '@supabase/supabase-js';
import { admin, handler, HttpError } from './_lib/http.js';

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const BAD = 'Invalid login credentials'; // same words as Supabase, so the sign-in page shows its usual message
// shortcut: per-instance memory, so the limit resets on restart and isn't shared between servers; move to the database if abused
const fails = new Map<string, { n: number; at: number }>();
const WINDOW = 10 * 60e3, MAX = 8;

// POST { username, password } -> { access_token, refresh_token }. Usernames only: emails sign in from the browser.
// The email behind a username is never sent back, so nobody can look up people's addresses by guessing usernames.
export default handler('POST', async (req) => {
  const { username, password } = req.body ?? {};
  const u = typeof username === 'string' ? username.trim().toLowerCase() : '';
  if (!USERNAME.test(u) || typeof password !== 'string' || !password || password.length > 200) throw new HttpError(400, BAD);
  const f = fails.get(u);
  if (f && Date.now() - f.at < WINDOW && f.n >= MAX) throw new HttpError(429, 'Too many attempts. Wait a few minutes, then try again.');

  const db = admin();
  const { data: p } = await db.from('tt_profiles').select('user_id').eq('username', u).maybeSingle();
  // the login email lives on the auth account; the profile copy is only for display
  const email = p ? (await db.auth.admin.getUserById(p.user_id)).data.user?.email : undefined;
  const auth = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = email ? await auth.auth.signInWithPassword({ email, password }) : { data: null, error: { message: BAD } };
  if (error || !data?.session) {
    const cur = f && Date.now() - f.at < WINDOW ? f : { n: 0, at: Date.now() };
    fails.set(u, { n: cur.n + 1, at: cur.at });
    throw new HttpError(400, /not confirmed/i.test(error?.message ?? '') ? 'Email not confirmed' : BAD);
  }
  fails.delete(u);
  return { access_token: data.session.access_token, refresh_token: data.session.refresh_token };
});
