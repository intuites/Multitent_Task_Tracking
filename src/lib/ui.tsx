import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

const LABELS: Record<string, string> = { completed_cycle: 'Completed This Cycle' };
// escalations were retired: their old notifications and log lines stay in the database, filtered out with .not(col, 'like', NO_ESC)
export const NO_ESC = 'escalation%';
export const label = (s: string) => LABELS[s] ?? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
export const fmtDay = (d?: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
export const fmtTime = (d?: string | null) => (d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
// date input (YYYY-MM-DD) -> timestamptz at local noon, so the calendar day is stable across zones
export const dateToTs = (v: FormDataEntryValue | null) => (v ? new Date(`${v}T12:00:00`).toISOString() : null);
export const isOpen = (status: string) => !['completed', 'completed_cycle'].includes(status);
export const isOverdue = (t: { due_date?: string | null; status: string }) => !!t.due_date && new Date(t.due_date) < new Date() && isOpen(t.status);

// the database functions that queue emails; after them the app asks the server to send right away
const QUEUES_EMAIL = new Set(['tt_assign', 'tt_set_task_status', 'tt_create_from_template', 'tt_create_organization', 'tt_platform_review_org']);

export async function rpc<T = any>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  if (QUEUES_EMAIL.has(name)) kickEmails();
  return data as T;
}

let kickTimer = 0;
/** Asks the server to send the emails just queued (api/flush), once, shortly after the last action.
 *  Failure is fine: the job running every 5 minutes sends them anyway. */
export function kickEmails() {
  clearTimeout(kickTimer);
  kickTimer = window.setTimeout(async () => {
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (token) await fetch('/api/flush', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    } catch { /* offline or not deployed yet: the scheduled job sends them */ }
  }, 1200);
}

export interface Person { id: string; name: string; email: string; role: string; active: boolean; avatar?: string | null }

// short-lived: someone who joins while the app is open shows up in pickers within 30 s, without a reload
const cache = new Map<string, Promise<Person[]>>();
const cachedAt = new Map<string, number>();
export function loadPeople(orgId: string, fresh = false): Promise<Person[]> {
  if (fresh || Date.now() - (cachedAt.get(orgId) ?? 0) > 30_000) cache.delete(orgId);
  if (!cache.has(orgId)) {
    cachedAt.set(orgId, Date.now());
    cache.set(orgId, (async () => {
      // '*' so this works before migration 0046; joined_at null = invited, not a member yet (see loadInvites)
      const { data: all } = await supabase.from('tt_org_members').select('*').eq('org_id', orgId);
      const m = (all ?? []).filter((x: any) => x.joined_at !== null);
      const ids = m.map((x) => x.user_id);
      const { data: p } = ids.length ? await supabase.from('tt_profiles').select('user_id, full_name, email, avatar_url').in('user_id', ids) : { data: [] as any[] };
      const pm = new Map((p ?? []).map((x: any) => [x.user_id, x]));
      return m.map((x) => {
        const pr: any = pm.get(x.user_id);
        return { id: x.user_id, name: pr?.full_name || pr?.email || 'Unknown', email: pr?.email ?? '', role: x.role, active: x.active, avatar: pr?.avatar_url ?? null };
      });
    })());
  }
  return cache.get(orgId)!;
}

/** People invited to the organization who haven't opened the email and set a password yet (migration 0046). */
export async function loadInvites(orgId: string): Promise<{ id: string; email: string; role: string; invited: string }[]> {
  const { data } = await supabase.from('tt_org_members').select('*').eq('org_id', orgId).is('joined_at', null);
  const rows = data ?? [];
  const { data: p } = rows.length ? await supabase.from('tt_profiles').select('user_id, email').in('user_id', rows.map((r: any) => r.user_id)) : { data: [] as any[] };
  const em = new Map((p ?? []).map((x: any) => [x.user_id, x.email]));
  return rows.map((r: any) => ({ id: r.user_id, email: em.get(r.user_id) ?? 'Unknown', role: r.role, invited: r.created_at }));
}

export function usePeople(orgId: string) {
  const [people, setPeople] = useState<Person[]>([]);
  const [loaded, setLoaded] = useState(false);
  // people who acted here without being members (a platform admin, someone since removed), looked up once each
  const [others, setOthers] = useState<Record<string, string>>({});
  const asked = useRef(new Set<string>());
  useEffect(() => { setLoaded(false); loadPeople(orgId).then((p) => { setPeople(p); setLoaded(true); }); }, [orgId]);
  const name = (id?: string | null) => {
    if (!id) return '—';
    const p = people.find((x) => x.id === id);
    if (p) return p.name;
    if (others[id]) return others[id];
    if (loaded && !asked.current.has(id)) {
      asked.current.add(id);
      // readable for platform admins; members can't read profiles outside their organization, and never learn who
      // a platform admin is: they see just "Taskify" (migrations 0045, 0050), anyone else they can't see "Removed member"
      (async () => {
        const { data } = await supabase.from('tt_profiles').select('full_name, email').eq('user_id', id).maybeSingle();
        const pa = data ? false : (await supabase.rpc('tt_is_platform_admin_id', { p_user: id })).data === true;
        setOthers((o) => ({ ...o, [id]: data?.full_name || data?.email || (pa ? 'Taskify' : 'Removed member') }));
      })();
    }
    return '…';
  };
  // the person's profile photo, wherever they appear (null: initials)
  const photo = (id?: string | null) => people.find((x) => x.id === id)?.avatar ?? null;
  return { people, active: people.filter((p) => p.active), name, photo };
}

/** Saves a generated file (Excel workbook etc.) through the browser's download. */
export function saveBlob(filename: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Reads every row of a query; PostgREST returns at most 1,000 rows per request. Pass a factory: a query builder can only run once. */
export async function fetchAll<T = any>(query: () => any, cap = 100000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; out.length < cap; from += 1000) {
    const { data, error } = await query().range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export const fileStamp = (name: string) => `${name.replace(/[^\w-]+/g, '_')}_${new Date().toISOString().slice(0, 10)}`;


export const Due = ({ t }: { t: { due_date?: string | null; status: string } }) =>
  <span className={isOverdue(t) ? 'overdue' : ''}>{fmt(t.due_date)}{isOverdue(t) && ' (overdue)'}</span>;

export const Badge = ({ v }: { v: string }) => <span className={`badge b-${v}`}>{label(v)}</span>;

// every IANA zone the browser knows; falls back to a short US-first list on old browsers
export const ZONES: string[] = (() => {
  try { return (Intl as any).supportedValuesOf('timeZone'); } catch { return ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'UTC', 'Europe/London', 'Asia/Kolkata']; }
})();
export const zoneList = (tz: string) => (ZONES.includes(tz) ? ZONES : [tz, ...ZONES]);
/** time zone dropdown for organization forms; New York unless told otherwise */
export const ZoneSelect = ({ value = 'America/New_York' }: { value?: string }) =>
  <select name="tz" defaultValue={value} required>{zoneList(value).map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}</select>;
