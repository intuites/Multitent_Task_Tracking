import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, configured, authLinkType } from './supabase';
import type { Role } from '../../api/_lib/permissions';

export interface Membership { org_id: string; role: Role; org_name: string; time_zone: string }
const ORG_KEY = 'tt-org';
export interface Portal { client_id: string; contact_id: string; client_name: string; can_approve: boolean; full_name: string }
interface Ctx {
  session: Session | null;
  membership: Membership | null;
  /** every organization this user belongs to; membership is the active one */
  memberships: Membership[];
  switchOrg: (orgId: string) => void;
  portal: Portal | null;
  platformAdmin: boolean;
  loading: boolean;
  /** set when the user arrived from a password-reset or invite link and must choose a password */
  passwordSetup: 'recovery' | 'invite' | null;
  finishPasswordSetup: () => void;
  refresh: () => void;
  signOut: () => Promise<void>;
}
const AuthCtx = createContext<Ctx>({ session: null, membership: null, memberships: [], switchOrg: () => {}, portal: null, platformAdmin: false, loading: true, passwordSetup: null, finishPasswordSetup: () => {}, refresh: () => {}, signOut: async () => {} });
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [portal, setPortal] = useState<Portal | null>(null);
  const [platformAdmin, setPlatformAdmin] = useState(false);
  const [loading, setLoading] = useState(configured);
  const [tick, setTick] = useState(0);
  const [passwordSetup, setPasswordSetup] = useState<'recovery' | 'invite' | null>(
    authLinkType === 'recovery' || authLinkType === 'invite' ? authLinkType : null);
  const finishPasswordSetup = useCallback(() => setPasswordSetup(null), []);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  // remember the choice per browser, then reload so every page re-reads data for the new org
  const switchOrg = useCallback((orgId: string) => {
    try { localStorage.setItem(ORG_KEY, orgId); } catch { /* ignore */ }
    window.location.assign('/');
  }, []);

  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); if (!data.session) setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => {
      if (e === 'PASSWORD_RECOVERY') setPasswordSetup('recovery');
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setMembership(null); setMemberships([]); setPortal(null); return; }
    (async () => {
      // RLS limits these reads to the caller's own rows; roles are never taken from the browser.
      const { data } = await supabase.from('tt_org_members').select('org_id, role, organizations:tt_organizations(name, time_zone)')
        .eq('user_id', session.user.id).eq('active', true).order('created_at');
      const all: Membership[] = (data ?? []).map((m: any) => ({ org_id: m.org_id, role: m.role, org_name: m.organizations?.name ?? '', time_zone: m.organizations?.time_zone ?? 'UTC' }));
      let saved: string | null = null;
      try { saved = localStorage.getItem(ORG_KEY); } catch { /* storage blocked: fall back to the first org */ }
      const m = all.find((x) => x.org_id === saved) ?? all[0];
      setMemberships(all);
      setMembership(m ?? null);
      if (!m) {
        const { data: c } = await supabase.from('tt_client_contacts').select('id, client_id, full_name, can_approve, clients:tt_clients(name)')
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
    <AuthCtx.Provider value={{ session, membership, memberships, switchOrg, portal, platformAdmin, loading, passwordSetup, finishPasswordSetup, refresh, signOut: async () => { await supabase.auth.signOut(); } }}>
      {children}
    </AuthCtx.Provider>
  );
}
