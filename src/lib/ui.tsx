import { useEffect, useState } from 'react';
import { supabase } from './supabase';

const LABELS: Record<string, string> = { completed_cycle: 'Completed This Cycle' };
export const label = (s: string) => LABELS[s] ?? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
export const fmtDay = (d?: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
export const fmtTime = (d?: string | null) => (d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
// date input (YYYY-MM-DD) -> timestamptz at local noon, so the calendar day is stable across zones
export const dateToTs = (v: FormDataEntryValue | null) => (v ? new Date(`${v}T12:00:00`).toISOString() : null);
export const isOpen = (status: string) => !['completed', 'completed_cycle'].includes(status);
export const isOverdue = (t: { due_date?: string | null; status: string }) => !!t.due_date && new Date(t.due_date) < new Date() && isOpen(t.status);

export async function rpc<T = any>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export interface Person { id: string; name: string; email: string; role: string; active: boolean }

const cache = new Map<string, Promise<Person[]>>();
export function loadPeople(orgId: string, fresh = false): Promise<Person[]> {
  if (fresh) cache.delete(orgId);
  if (!cache.has(orgId)) {
    cache.set(orgId, (async () => {
      const { data: m } = await supabase.from('tt_org_members').select('user_id, role, active').eq('org_id', orgId);
      const ids = (m ?? []).map((x) => x.user_id);
      const { data: p } = ids.length ? await supabase.from('tt_profiles').select('user_id, full_name, email').in('user_id', ids) : { data: [] as any[] };
      const pm = new Map((p ?? []).map((x: any) => [x.user_id, x]));
      return (m ?? []).map((x) => {
        const pr: any = pm.get(x.user_id);
        return { id: x.user_id, name: pr?.full_name || pr?.email || 'Unknown', email: pr?.email ?? '', role: x.role, active: x.active };
      });
    })());
  }
  return cache.get(orgId)!;
}

export function usePeople(orgId: string) {
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => { loadPeople(orgId).then(setPeople); }, [orgId]);
  const name = (id?: string | null) => people.find((p) => p.id === id)?.name ?? (id ? 'Unknown' : '—');
  return { people, active: people.filter((p) => p.active), name };
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
