import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, configured, authLinkType } from './supabase';
import type { Role } from '../../api/_lib/permissions';
import { applyBrand } from './theme';

/** platform: a platform admin working in an org they aren't a member of (acts as owner there; the database agrees, see migration 0018) */
export interface Membership { org_id: string; role: Role; org_name: string; time_zone: string; brand_color?: string | null; platform?: boolean }
const ORG_KEY = 'tt-org';
/** an organization this user created that a platform admin hasn't approved (newest first) */
export interface OrgRequest { id: string; name: string; status: 'pending' | 'rejected'; created_at: string }
interface Ctx {
  session: Session | null;
  membership: Membership | null;
  /** every organization this user belongs to; membership is the active one */
  memberships: Membership[];
  switchOrg: (orgId: string) => void;
  requests: OrgRequest[];
  platformAdmin: boolean;
  loading: boolean;
  /** set when the user arrived from a password-reset or invite link and must choose a password */
  passwordSetup: 'recovery' | 'invite' | null;
  finishPasswordSetup: () => void;
  refresh: () => void;
  signOut: () => Promise<void>;
}
const AuthCtx = createContext<Ctx>({ session: null, membership: null, memberships: [], switchOrg: () => {}, requests: [], platformAdmin: false, loading: true, passwordSetup: null, finishPasswordSetup: () => {}, refresh: () => {}, signOut: async () => {} });
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [platformAdmin, setPlatformAdmin] = useState(false);
  const [requests, setRequests] = useState<OrgRequest[]>([]);
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
      // hourly token refreshes (and tab refocus) don't change who is signed in; ignoring them stops every page re-loading its data
      if (e === 'TOKEN_REFRESHED') return;
      setSession((cur) => (cur?.user.id === s?.user.id && cur?.access_token === s?.access_token ? cur : s));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setMembership(null); setMemberships([]); setRequests([]); return; }
    (async () => {
      // RLS limits these reads to the caller's own rows; roles are never taken from the browser.
      // `*` so this still works before migration 0029 adds brand_color
      const { data } = await supabase.from('tt_org_members').select('org_id, role, organizations:tt_organizations(*)')
        .eq('user_id', session.user.id).eq('active', true).order('created_at');
      let all: Membership[] = (data ?? []).map((m: any) => ({ org_id: m.org_id, role: m.role, org_name: m.organizations?.name ?? '', time_zone: m.organizations?.time_zone ?? 'UTC', brand_color: m.organizations?.brand_color ?? null }));
      // platform admins belong to no organization: they open every one with full control, never through a membership
      const pa = (await supabase.rpc('tt_is_platform_admin')).data === true;
      if (pa) {
        const { data: orgs } = await supabase.from('tt_organizations').select('*').order('name');
        all = (orgs ?? []).map((o) => ({ org_id: o.id, role: 'owner', org_name: o.name, time_zone: o.time_zone ?? 'UTC', brand_color: o.brand_color ?? null, platform: true }));
      }
      let saved: string | null = null;
      try { saved = localStorage.getItem(ORG_KEY); } catch { /* storage blocked: fall back to the first org */ }
      const m = all.find((x) => x.org_id === saved) ?? all[0];
      setMemberships(all);
      setMembership(m ?? null);
      // before migration 0026 there is no status column; the query errors and the list stays empty
      const { data: reqs } = pa ? { data: [] } : await supabase.from('tt_organizations').select('id, name, status, created_at')
        .eq('created_by', session.user.id).neq('status', 'approved').order('created_at', { ascending: false });
      setRequests((reqs ?? []) as OrgRequest[]);
      setPlatformAdmin(pa);
      setLoading(false);
    })();
  }, [session?.user.id, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // the open organization's colors once known (signed out: the default green); index.html shows the cached one until then
  useEffect(() => { if (!loading) applyBrand(session ? membership?.brand_color : null); }, [loading, session, membership]);

  return (
    <AuthCtx.Provider value={{ session, membership, memberships, switchOrg, requests, platformAdmin, loading, passwordSetup, finishPasswordSetup, refresh, signOut: async () => { await supabase.auth.signOut(); } }}>
      {children}
    </AuthCtx.Provider>
  );
}
