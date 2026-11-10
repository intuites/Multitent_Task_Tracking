import { HttpError, type Req } from './http.js';

export const ip = (req: Req) => String(req.headers['x-forwarded-for'] ?? req.headers['x-real-ip'] ?? '').split(',')[0].trim() || 'unknown';

/** Google reCAPTCHA v2 check. Does nothing until RECAPTCHA_SECRET_KEY is set, so sign-in keeps working before setup. */
export async function checkCaptcha(req: Req) {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) return;
  const token = req.body?.captcha;
  if (typeof token !== 'string' || !token || token.length > 4000) throw new HttpError(400, 'Tick “I’m not a robot” first.');
  const r = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token, remoteip: ip(req) }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!j.success) {
    console.error('recaptcha failed', j['error-codes']);
    throw new HttpError(400, 'The robot check expired. Tick “I’m not a robot” again.');
  }
}
