import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkCaptcha } from './captcha';

const req = (captcha?: unknown) => ({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, body: { captcha } });
const google = (body: object) => vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body)));

describe('checkCaptcha', () => {
  const real = process.env.RECAPTCHA_SECRET_KEY; // a local .env may hold the real one
  beforeEach(() => { delete process.env.RECAPTCHA_SECRET_KEY; });
  afterEach(() => { vi.restoreAllMocks(); if (real === undefined) delete process.env.RECAPTCHA_SECRET_KEY; else process.env.RECAPTCHA_SECRET_KEY = real; });

  it('is off until the secret is set', async () => {
    const f = google({ success: false });
    await expect(checkCaptcha(req())).resolves.toBeUndefined();
    expect(f).not.toHaveBeenCalled();
  });

  it('needs an answer once the secret is set', async () => {
    process.env.RECAPTCHA_SECRET_KEY = 's';
    const f = google({ success: true });
    await expect(checkCaptcha(req(''))).rejects.toMatchObject({ code: 400 });
    await expect(checkCaptcha(req(42))).rejects.toMatchObject({ code: 400 });
    expect(f).not.toHaveBeenCalled();
  });

  it("rejects what Google rejects and passes the caller's address", async () => {
    process.env.RECAPTCHA_SECRET_KEY = 's';
    const f = google({ success: false, 'error-codes': ['timeout-or-duplicate'] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(checkCaptcha(req('tok'))).rejects.toMatchObject({ code: 400 });
    const sent = new URLSearchParams(String((f.mock.calls[0][1] as RequestInit).body));
    expect([sent.get('secret'), sent.get('response'), sent.get('remoteip')]).toEqual(['s', 'tok', '1.2.3.4']);
  });

  it('accepts what Google accepts', async () => {
    process.env.RECAPTCHA_SECRET_KEY = 's';
    google({ success: true });
    await expect(checkCaptcha(req('tok'))).resolves.toBeUndefined();
  });
});
