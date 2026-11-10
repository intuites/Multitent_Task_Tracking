import { admin, appUrl, handler, HttpError } from './_lib/http.js';
import { checkCaptcha, ip } from './_lib/captcha.js';
import { sendEmail } from './_lib/email.js';
import { confirmSignup } from './_lib/emailTemplates.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// shortcut: per-instance memory, resets on restart; move to the database if abused
const recent = new Map<string, { n: number; at: number }>();
const WINDOW = 60 * 60e3, PER_IP = 5;
function tooMany(key: string) {
  const now = Date.now(), cur = recent.get(key);
  const t = cur && now - cur.at < WINDOW ? cur : { n: 0, at: now };
  t.n++; recent.set(key, t);
  if (recent.size > 10_000) for (const [k, v] of recent) if (now - v.at >= WINDOW) recent.delete(k);
  return t.n > PER_IP;
}

// POST { full_name, email, password, captcha } -> { ok }. Public sign-up is turned off in Supabase,
// so every new account passes the robot check here; the confirmation email goes out through Taskify's own mail.
export default handler('POST', async (req) => {
  const { full_name, email, password } = req.body ?? {};
  const name = typeof full_name === 'string' ? full_name.trim() : '';
  const em = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!name || name.length > 120) throw new HttpError(400, 'Enter your full name.');
  if (!EMAIL.test(em) || em.length > 254) throw new HttpError(400, 'Enter a valid email address.');
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) throw new HttpError(400, 'Use a password of at least 8 characters.');
  if (tooMany(ip(req))) throw new HttpError(429, 'Too many sign-ups from this network. Try again in an hour.');
  await checkCaptcha(req);

  const app = appUrl(req);
  const { data, error } = await admin().auth.admin.generateLink({ type: 'signup', email: em, password, options: { data: { full_name: name }, redirectTo: app || undefined } });
  if (error || !data.properties?.action_link) {
    if (error && /already|registered|exists/i.test(error.message)) throw new HttpError(409, 'User already registered');
    console.error('signup generateLink failed', error?.status, error?.message);
    throw new HttpError(400, 'Could not create the account. Try again in a minute.');
  }
  const mail = confirmSignup(name, data.properties.action_link, app);
  const sent = await sendEmail(em, mail.subject, mail.text, mail.html);
  if (!sent.ok) {
    console.error('signup email failed', sent.error);
    throw new HttpError(502, "We couldn't send the email right now. Try again in a minute, or contact your admin.");
  }
  return { ok: true };
});
