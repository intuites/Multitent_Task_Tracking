// Sends through SMTP (Nodemailer, e.g. Gmail with an App Password) when SMTP_PASS is set,
// else the Gmail API (Google OAuth refresh token) when GOOGLE_REFRESH_TOKEN is set, otherwise Resend.
import nodemailer from 'nodemailer';

type Result = { ok: boolean; id?: string; error?: string };

export async function sendEmail(to: string, subject: string, text: string, html?: string): Promise<Result> {
  // header values come from the database: never let a newline start a new header
  to = to.replace(/[\r\n]/g, ''); subject = subject.replace(/[\r\n]+/g, ' ');
  try {
    if (process.env.SMTP_PASS) return await smtp(to, subject, text, html);
    return process.env.GOOGLE_REFRESH_TOKEN ? await gmail(to, subject, text, html) : await resend(to, subject, text, html);
  } catch (e) {
    return { ok: false, error: `Network error: ${e instanceof Error ? e.message : 'unknown'}`.slice(0, 300) };
  }
}

let mailer: ReturnType<typeof nodemailer.createTransport> | null = null;
async function smtp(to: string, subject: string, text: string, html?: string): Promise<Result> {
  const user = process.env.SMTP_USER, from = process.env.EMAIL_FROM || user;
  if (!user || !from) return { ok: false, error: 'SMTP not configured (SMTP_USER, SMTP_PASS)' };
  const port = Number(process.env.SMTP_PORT) || 465;
  mailer ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com', port, secure: port === 465,
    auth: { user, pass: process.env.SMTP_PASS!.replace(/\s/g, '') }, // Google shows App Passwords with spaces
  });
  try {
    const info = await mailer.sendMail({ from, to, subject, text, ...(html ? { html } : {}) });
    if (info.accepted.length && !info.rejected.length) return { ok: true, id: info.messageId };
    return { ok: false, error: `SMTP rejected: ${info.response}`.slice(0, 300) };
  } catch (e) {
    // e.g. 535 bad username/password: the message says so, without the password
    return { ok: false, error: `SMTP: ${e instanceof Error ? e.message : 'failed'}`.slice(0, 300) };
  }
}

async function resend(to: string, subject: string, text: string, html?: string): Promise<Result> {
  const key = process.env.EMAIL_PROVIDER_API_KEY, from = process.env.EMAIL_FROM;
  if (!key || !from) return { ok: false, error: 'Email provider not configured' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, text, ...(html ? { html } : {}) }),
  });
  const j: any = await r.json().catch(() => ({}));
  // only a 2xx with a message id counts as accepted by the provider
  if (r.ok && j.id) return { ok: true, id: j.id };
  return { ok: false, error: `Provider ${r.status}: ${j.message ?? 'rejected'}`.slice(0, 300) };
}

let token: { value: string; until: number } | null = null;
async function googleToken() {
  if (token && token.until > Date.now() + 60_000) return token.value;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '', client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN ?? '', grant_type: 'refresh_token',
    }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Google sign-in ${r.status}: ${j.error_description ?? j.error ?? 'failed'}`);
  token = { value: j.access_token, until: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return token.value;
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
/** A multipart (plain text + HTML) message, as the Gmail API wants it: base64url of the raw MIME. */
export function mime(from: string, to: string, subject: string, text: string, html?: string) {
  const b = `tt-${Date.now().toString(36)}`;
  const head = [`From: ${from}`, `To: ${to}`, `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`, 'MIME-Version: 1.0'];
  const part = (type: string, body: string) => [`--${b}`, `Content-Type: ${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', b64(body)];
  const lines = [...head, `Content-Type: multipart/alternative; boundary="${b}"`, '', ...part('text/plain', text), ...(html ? part('text/html', html) : []), `--${b}--`, ''];
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}

async function gmail(to: string, subject: string, text: string, html?: string): Promise<Result> {
  const from = process.env.EMAIL_FROM;
  if (!from || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return { ok: false, error: 'Gmail not configured (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, EMAIL_FROM)' };
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await googleToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: mime(from, to, subject, text, html) }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (r.ok && j.id) return { ok: true, id: j.id };
  if (r.status === 401) token = null; // expired or revoked: fetch a new one next time
  return { ok: false, error: `Gmail ${r.status}: ${j.error?.message ?? 'rejected'}`.slice(0, 300) };
}
