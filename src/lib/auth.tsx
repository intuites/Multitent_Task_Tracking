import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, configured, authLinkType } from './supabase';
import type { Role } from '../../api/_lib/permissions';
import { applyLook, applyThemePref, lookOf, lookToKeep, prefsFor, themePref, type Prefs } from './theme';
import { readLastUser, saveLastUser } from './lastUser';
import { setOrgZone } from './greeting';

/** platform: a platform admin working in an org they aren't a member of (acts as owner there; the database agrees, see migration 0018) */
export interface Membership {
  org_id: string; role: Role; org_name: string; time_zone: string; brand_color?: string | null; font_family?: string | null; font_style?: string | null;
  text_size?: string | null; require_admin_mfa?: boolean; platform?: boolean;
}
const fromOrg = (o: any) => ({ org_name: o?.name ?? '', time_zone: o?.time_zone ?? 'UTC', brand_color: o?.brand_color ?? null, font_family: o?.font_family ?? null,
  font_style: o?.font_style ?? null, text_size: o?.text_size ?? null, require_admin_mfa: o?.require_admin_mfa === true });
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
  /** the person's own look (Profile → Appearance); fields left out follow the organization */
  prefs: Prefs;
  savePrefs: (p: Prefs) => Promise<void>;
  /** an admin here must still finish two-factor sign-in */
  mfaNeeded: boolean;
  mfaDone: () => void;
  signOut: () => Promise<void>;
}
const AuthCtx = createContext<Ctx>({ session: null, membership: null, memberships: [], switchOrg: () => {}, requests: [], platformAdmin: false, loading: true, passwordSetup: null,
  finishPasswordSetup: () => {}, refresh: () => {}, prefs: {}, savePrefs: async () => {}, mfaNeeded: false, mfaDone: () => {}, signOut: async () => {} });
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [platformAdmin, setPlatformAdmin] = useState(false);
  const [requests, setRequests] = useState<OrgRequest[]>([]);
  const [loading, setLoading] = useState(configured);
  const [tick, setTick] = useState(0);
  const [prefs, setPrefs] = useState<Prefs>({});
  const [aal2, setAal2] = useState(false);
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
      // invitations become memberships once the account has a password (migration 0046; does nothing before it or without one)
      await supabase.rpc('tt_accept_invites');
      // RLS limits these reads to the caller's own rows; roles are never taken from the browser.
      // `*` so this still works before migration 0029 adds brand_color
      const { data } = await supabase.from('tt_org_members').select('org_id, role, organizations:tt_organizations(*)')
        .eq('user_id', session.user.id).eq('active', true).order('created_at');
      let all: Membership[] = (data ?? []).map((m: any) => ({ org_id: m.org_id, role: m.role, ...fromOrg(m.organizations) }));
      // platform admins belong to no organization: they open every one with full control, never through a membership
      const pa = (await supabase.rpc('tt_is_platform_admin')).data === true;
      if (pa) {
        const { data: orgs } = await supabase.from('tt_organizations').select('*').order('name');
        all = (orgs ?? []).map((o) => ({ org_id: o.id, role: 'owner', ...fromOrg(o), platform: true }));
      }
      // the person's own look (migration 0036); '*' so this still works before the column exists
      const { data: prof } = await supabase.from('tt_profiles').select('*').eq('user_id', session.user.id).maybeSingle();
      let p: Prefs = prof?.prefs && typeof prof.prefs === 'object' ? prof.prefs : {};
      const aal = (await supabase.auth.mfa.getAuthenticatorAssuranceLevel()).data?.currentLevel;
      setAal2(aal === 'aal2');
      let saved: string | null = null;
      try { saved = localStorage.getItem(ORG_KEY); } catch { /* storage blocked: fall back to the first org */ }
      const m = all.find((x) => x.org_id === saved) ?? all[0];
      // everyone's look is their own: keep what they see now, so an admin's organization change doesn't reach them
      const keep = prof && 'prefs' in prof && m ? lookToKeep(p, m) : null;
      if (keep) { p = keep; supabase.from('tt_profiles').update({ prefs: keep }).eq('user_id', session.user.id).then(() => {}); }
      setPrefs(p);
      saveLastUser({ name: prof?.full_name || session.user.email?.split('@')[0], org: m?.org_name ?? '', photo: prof?.avatar_url ?? null }); // the sign-in page's greeting next time
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

  // the person's own look over the open organization's (signed out: the defaults); index.html shows the cached one until then
  useEffect(() => {
    if (loading) return;
    // signed out: the look of whoever last signed in here (sign-in page greeting), else Taskify's defaults
    const mine = prefsFor(prefs, membership?.org_id); // a look saved for this organization only wins
    if (session) saveLastUser({ look: lookOf(mine, membership) });
    applyLook(session ? membership : null, session ? mine : readLastUser()?.look ?? {});
    setOrgZone(membership?.time_zone);
  }, [loading, session, membership, prefs]);
  useEffect(() => { if (!loading && session) applyThemePref(prefs.theme); }, [loading, session, prefs.theme]);
  // Prefs as saved right now. Every save starts from this, not from this tab's copy: a tab opened before you saved a
  // color elsewhere (another computer or tab, or a platform admin) would otherwise write the old color back.
  const savedPrefs = useCallback(async (): Promise<Prefs> => {
    const { data } = await supabase.from('tt_profiles').select('prefs').eq('user_id', session!.user.id).maybeSingle();
    return data?.prefs && typeof data.prefs === 'object' ? data.prefs : {};
  }, [session]);
  // the top-bar theme toggle: remember the switch with the account too, so every device follows (only the theme changes)
  const prefsRef = useRef(prefs); prefsRef.current = prefs;
  useEffect(() => {
    if (!session) return;
    const on = async () => {
      const t = themePref();
      if (prefsRef.current.theme === t) return;
      setPrefs((p) => ({ ...p, theme: t }));
      const cur = await savedPrefs();
      if (cur.theme === t) return;
      const next = { ...cur, theme: t };
      setPrefs(next);
      supabase.from('tt_profiles').update({ prefs: next }).eq('user_id', session.user.id).then(() => {}); // before 0036: stays on this device
    };
    // back to this tab: pick up a look saved meanwhile on another computer or tab
    const back = async () => {
      if (document.visibilityState !== 'visible') return;
      const cur = await savedPrefs();
      if (Object.keys(cur).length && JSON.stringify(cur) !== JSON.stringify(prefsRef.current)) setPrefs(cur);
    };
    window.addEventListener('tt-theme', on);
    document.addEventListener('visibilitychange', back);
    return () => { window.removeEventListener('tt-theme', on); document.removeEventListener('visibilitychange', back); };
  }, [session, savedPrefs]);
  const savePrefs = useCallback(async (changes: Prefs) => {
    const next = { ...(await savedPrefs()), ...changes };
    const { error } = await supabase.from('tt_profiles').update({ prefs: next }).eq('user_id', session!.user.id);
    if (error) throw new Error(/column|schema cache/i.test(error.message) ? 'Saving your look needs the database update (migration 0036) first.' : error.message);
    setPrefs(next);
  }, [session, savedPrefs]);
  // admins of an organization that requires two-factor must finish it before they get in (the database enforces it too)
  const mfaNeeded = !!membership?.require_admin_mfa && (membership.role === 'owner' || membership.role === 'admin') && !aal2;

  return (
    <AuthCtx.Provider value={{ session, membership, memberships, switchOrg, requests, platformAdmin, loading, passwordSetup, finishPasswordSetup, refresh,
      prefs, savePrefs, mfaNeeded, mfaDone: () => setAal2(true), signOut: async () => { await supabase.auth.signOut(); } }}>
      {children}
    </AuthCtx.Provider>
  );
}
