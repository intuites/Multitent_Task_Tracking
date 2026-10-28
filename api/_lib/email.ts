// Provider: Resend (https://resend.com). Swap this one function to change provider.
export async function sendEmail(to: string, subject: string, text: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const key = process.env.EMAIL_PROVIDER_API_KEY, from = process.env.EMAIL_FROM;
  if (!key || !from) return { ok: false, error: 'Email provider not configured' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text }),
    });
    const j: any = await r.json().catch(() => ({}));
    // only a 2xx with a message id counts as accepted by the provider
    if (r.ok && j.id) return { ok: true, id: j.id };
    return { ok: false, error: `Provider ${r.status}: ${j.message ?? 'rejected'}`.slice(0, 300) };
  } catch (e) {
    return { ok: false, error: `Network error: ${e instanceof Error ? e.message : 'unknown'}`.slice(0, 300) };
  }
}
