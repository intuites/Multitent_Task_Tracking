import { admin, appUrl, handler, HttpError } from './_lib/http.js';
import { checkCaptcha, ip } from './_lib/captcha.js';
import { sendEmail } from './_lib/email.js';
import { resetEmail } from './_lib/emailTemplates.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// shortcut: per-instance memory, resets on restart; move to the database if abused
const recent = new Map<string, { n: number; at: number }>();
const WINDOW = 60 * 60e3;
function tooMany(key: string, max: number) {
  const now = Date.now(), cur = recent.get(key);
  const t = cur && now - cur.at < WINDOW ? cur : { n: 0, at: now };
  t.n++; recent.set(key, t);
  if (recent.size > 10_000) for (const [k, v] of recent) if (now - v.at >= WINDOW) recent.delete(k);
  return t.n > max;
}

// POST { email, captcha } -> { ok }. The robot check, then the reset link goes out through Taskify's own mail (SMTP).
// Always "ok" for a valid address, so nobody can learn which emails have accounts.
export default handler('POST', async (req) => {
  const em = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!EMAIL.test(em) || em.length > 254) throw new HttpError(400, 'Enter a valid email address.');
  // a few per address and per network each hour, so nobody can flood someone's inbox
  if (tooMany(`e:${em}`, 3) || tooMany(`i:${ip(req)}`, 10)) throw new HttpError(429, 'Too many reset emails. Wait a while, then try again.');
  await checkCaptcha(req);
  const app = appUrl(req);
  const { data, error } = await admin().auth.admin.generateLink({ type: 'recovery', email: em, options: { redirectTo: app || undefined } });
  const link = data?.properties?.action_link;
  if (!link) {
    if (error && !/not found|no user/i.test(error.message)) console.error('recovery link failed', error.status, error.message);
    return { ok: true }; // no account with this email: say nothing
  }
  const mail = resetEmail(link, app);
  const sent = await sendEmail(em, mail.subject, mail.text, mail.html);
  if (!sent.ok) {
    console.error('reset email failed', sent.error);
    throw new HttpError(502, "We couldn't send the email right now. Try again in a minute.");
  }
  return { ok: true };
});
