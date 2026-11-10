import { appUrl, handler, HttpError } from './_lib/http.js';
import { checkCaptcha } from './_lib/captcha.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST { email, captcha } -> { ok }. The robot check, then Supabase sends its usual password-reset email.
// Always "ok" for a valid address, so nobody can learn which emails have accounts.
export default handler('POST', async (req) => {
  const em = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!EMAIL.test(em) || em.length > 254) throw new HttpError(400, 'Enter a valid email address.');
  await checkCaptcha(req);
  const app = appUrl(req);
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/recover${app ? `?redirect_to=${encodeURIComponent(app)}` : ''}`, {
    method: 'POST',
    headers: { apikey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!, 'content-type': 'application/json' },
    body: JSON.stringify({ email: em }),
  });
  if (r.status === 429) throw new HttpError(429, 'Too many reset emails. Wait a few minutes, then try again.');
  if (!r.ok) console.error('recover failed', r.status, await r.text().catch(() => ''));
  return { ok: true };
});
