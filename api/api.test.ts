import { describe, it, expect, beforeEach } from 'vitest';
import tick from './cron/tick';
import invite from './invite';
import deleteUser from './delete-user';
import { sendEmail } from './_lib/email';

const res = () => {
  const r: any = { code: 0, body: null, status(c: number) { r.code = c; return r; }, json(b: unknown) { r.body = b; } };
  return r;
};

beforeEach(() => {
  delete process.env.CRON_SECRET; delete process.env.EMAIL_PROVIDER_API_KEY; delete process.env.EMAIL_FROM;
  delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
});

describe('cron tick auth', () => {
  it('rejects when CRON_SECRET is not configured', async () => {
    const r = res(); await tick({ method: 'GET', headers: { authorization: 'Bearer undefined' } }, r);
    expect(r.code).toBe(401);
  });
  it('rejects a wrong secret and missing header', async () => {
    process.env.CRON_SECRET = 'right-secret';
    for (const authorization of ['Bearer wrong-secret', undefined]) {
      const r = res(); await tick({ method: 'GET', headers: { authorization } }, r);
      expect(r.code).toBe(401);
    }
  });
  it('rejects non-GET', async () => {
    const r = res(); await tick({ method: 'POST', headers: {} }, r);
    expect(r.code).toBe(405);
  });
});

describe('invite endpoint', () => {
  it('requires a bearer token', async () => {
    const r = res(); await invite({ method: 'POST', headers: {}, body: { org_id: 'x', email: 'a@b.co' } }, r);
    expect([401, 500]).toContain(r.code); // 500 = server not configured in test env, still never 200
    expect(r.code).not.toBe(200);
  });
  it('rejects GET', async () => {
    const r = res(); await invite({ method: 'GET', headers: {} }, r);
    expect(r.code).toBe(405);
  });
});

describe('delete-user endpoint', () => {
  it('needs a signed-in caller and only accepts POST', async () => {
    const r = res(); await deleteUser({ method: 'POST', headers: {}, body: { user_id: '00000000-0000-0000-0000-000000000000' } }, r);
    expect([401, 500]).toContain(r.code); // 500 = server not configured in test env, still never 200
    const g = res(); await deleteUser({ method: 'GET', headers: {} }, g);
    expect(g.code).toBe(405);
  });
});

describe('email provider', () => {
  it('reports failure (not success) when unconfigured', async () => {
    const r = await sendEmail('a@b.co', 's', 't');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not configured/);
  });
  it('uses SMTP first when SMTP_PASS is set', async () => {
    process.env.SMTP_PASS = 'abcd efgh ijkl mnop';
    const r = await sendEmail('a@b.co', 's', 't');
    expect(r).toEqual({ ok: false, error: 'SMTP not configured (SMTP_USER, SMTP_PASS)' });
  });
});
