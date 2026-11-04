import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

// Live updates: one Supabase Realtime channel per signed-in person (opened by the app shell). Every change is re-sent on
// window as a 'tt-live' event and pages listen with useLive. Realtime applies RLS, so nobody hears about rows they can't read.
export type LiveTable = 'tt_tasks' | 'tt_task_assignees' | 'tt_task_comments' | 'tt_notifications' | 'tt_organizations';
export interface LiveEvent { table: LiveTable; row: Record<string, any> }
const EVT = 'tt-live';
const ALL: LiveTable[] = ['tt_tasks', 'tt_task_assignees', 'tt_task_comments', 'tt_notifications', 'tt_organizations'];

const send = (table: LiveTable, row: Record<string, any> = {}) => window.dispatchEvent(new CustomEvent<LiveEvent>(EVT, { detail: { table, row } }));

export function startLive(orgId: string, uid: string) {
  const on = (table: LiveTable) => (p: any) => send(table, { ...p.old, ...p.new });
  let joined = false;
  // after a dropped connection or a hidden tab, changes may have been missed: tell every listener to refresh
  // (not the organization: it rarely changes, and re-reading it reloads every page)
  const catchUp = () => ALL.filter((t) => t !== 'tt_organizations').forEach((t) => send(t));
  const filters: Record<LiveTable, string | undefined> = {
    tt_tasks: `org_id=eq.${orgId}`, tt_task_assignees: undefined, tt_task_comments: `org_id=eq.${orgId}`, tt_notifications: `user_id=eq.${uid}`,
    tt_organizations: `id=eq.${orgId}`,
  };
  // one channel per table: if a table isn't broadcast yet (migration not run), Realtime rejects the whole channel, so keep them apart
  const chans = ALL.map((table) => supabase.channel(`live-${table}-${uid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table, filter: filters[table] }, on(table))
    .subscribe((status) => { if (status === 'SUBSCRIBED' && table === 'tt_tasks') { if (joined) catchUp(); joined = true; } }));
  const vis = () => { if (document.visibilityState === 'visible') catchUp(); };
  document.addEventListener('visibilitychange', vis);
  return () => { document.removeEventListener('visibilitychange', vis); chans.forEach((c) => supabase.removeChannel(c)); };
}

/** Runs onChange once per burst of changes to these tables (a bulk change of 20 rows is one reload).
 *  `match` narrows to the rows that matter; an event with no row (a catch-up) always matches. */
export function useLive(tables: LiveTable[], onChange: () => void, match?: (row: Record<string, any>) => boolean, wait = 500) {
  const ref = useRef({ onChange, match });
  ref.current = { onChange, match };
  const key = tables.join();
  useEffect(() => {
    const want = key.split(',');
    let t: number | undefined;
    const on = (e: Event) => {
      const { table, row } = (e as CustomEvent<LiveEvent>).detail;
      if (!want.includes(table)) return;
      if (ref.current.match && Object.keys(row).length && !ref.current.match(row)) return;
      clearTimeout(t);
      t = window.setTimeout(() => ref.current.onChange(), wait);
    };
    window.addEventListener(EVT, on);
    return () => { window.removeEventListener(EVT, on); clearTimeout(t); };
  }, [key, wait]);
}
