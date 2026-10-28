import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, configured } from './supabase';
import type { Role } from '../../api/_lib/permissions';

interface Membership { org_id: string; role: Role; org_name: string; time_zone: string }
export interface Portal { client_id: string; contact_id: string; client_name: string; can_approve: boolean; full_name: string }
interface Ctx {
  session: Session | null;
  membership: Membership | null;
  portal: Portal | null;
  platformAdmin: boolean;
  loading: boolean;
  refresh: () => void;
  signOut: () => Promise<void>;
}
const AuthCtx = createContext<Ctx>({ session: null, membership: null, portal: null, platformAdmin: false, loading: true, refresh: () => {}, signOut: async () => {} });
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [portal, setPortal] = useState<Portal | null>(null);
  const [platformAdmin, setPlatformAdmin] = useState(false);
  const [loading, setLoading] = useState(configured);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); if (!data.session) setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setMembership(null); setPortal(null); return; }
    (async () => {
      // RLS limits these reads to the caller's own rows; roles are never taken from the browser.
      const { data } = await supabase.from('org_members').select('org_id, role, organizations(name, time_zone)')
        .eq('user_id', session.user.id).eq('active', true).order('created_at').limit(1);
      const m = data?.[0] as any;
      setMembership(m ? { org_id: m.org_id, role: m.role, org_name: m.organizations?.name ?? '', time_zone: m.organizations?.time_zone ?? 'UTC' } : null);
      if (!m) {
        const { data: c } = await supabase.from('client_contacts').select('id, client_id, full_name, can_approve, clients(name)')
          .eq('user_id', session.user.id).eq('portal_access', true).eq('status', 'active').limit(1);
        const x = c?.[0] as any;
        setPortal(x ? { client_id: x.client_id, contact_id: x.id, client_name: x.clients?.name ?? '', can_approve: x.can_approve, full_name: x.full_name } : null);
      } else setPortal(null);
      const pa = await supabase.rpc('tt_is_platform_admin');
      setPlatformAdmin(pa.data === true);
      setLoading(false);
    })();
  }, [session, tick]);

  return (
    <AuthCtx.Provider value={{ session, membership, portal, platformAdmin, loading, refresh, signOut: async () => { await supabase.auth.signOut(); } }}>
      {children}
    </AuthCtx.Provider>
  );
}
