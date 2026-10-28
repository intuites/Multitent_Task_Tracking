import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export const label = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
export const fmtDay = (d?: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString() : '—');
export const fmtTime = (d?: string | null) => (d ? new Date(d).toLocaleString() : '—');
// date input (YYYY-MM-DD) -> timestamptz at local noon, so the calendar day is stable across zones
export const dateToTs = (v: FormDataEntryValue | null) => (v ? new Date(`${v}T12:00:00`).toISOString() : null);
export const isOpen = (status: string) => !['completed', 'cancelled'].includes(status);
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

export function download(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  // prefix formula-triggering characters so spreadsheets do not execute cell content
  const cell = (v: unknown) => { let s = v == null ? '' : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const Due = ({ t }: { t: { due_date?: string | null; status: string } }) =>
  <span className={isOverdue(t) ? 'overdue' : ''}>{fmt(t.due_date)}{isOverdue(t) && ' (overdue)'}</span>;

export const Badge = ({ v }: { v: string }) => <span className={`badge b-${v}`}>{label(v)}</span>;
