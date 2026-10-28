import { createClient } from '@supabase/supabase-js';

export interface Req { method?: string; headers: Record<string, string | string[] | undefined>; body?: any; query?: Record<string, string> }
export interface Res { status(c: number): Res; json(o: unknown): void }

export class HttpError extends Error { constructor(public code: number, msg: string) { super(msg); } }

// Service-role client: server only, bypasses RLS. Every caller must authorize explicitly first.
export const admin = () => {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(500, 'Server is not configured');
  return createClient(url, key, { auth: { persistSession: false } });
};

export async function authUser(req: Req) {
  const h = req.headers.authorization;
  const token = typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) throw new HttpError(401, 'Not authenticated');
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Not authenticated');
  return data.user;
}

/** Wraps a handler: method check + uniform JSON errors (no stack traces / SQL details leak). */
export const handler = (method: string, fn: (req: Req) => Promise<unknown>) => async (req: Req, res: Res) => {
  try {
    if (req.method !== method) throw new HttpError(405, 'Method not allowed');
    res.status(200).json(await fn(req));
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.code).json({ error: e.message });
    console.error('api error', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Server error' });
  }
};
