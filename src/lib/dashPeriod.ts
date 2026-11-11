/** The Dashboard's period filter. Open, overdue, pending and progress count tasks DUE in the period;
 *  completed counts tasks COMPLETED in it; due today is always today. */
export type Period = 'week' | 'month' | 'all';
export const PERIODS: [Period, string][] = [['week', 'This week'], ['month', 'This month'], ['all', 'All time']];

/** [start, end) in local time; null for all time. The week runs Sunday to Saturday, like the completed chart. */
export function periodBounds(p: Period, now = new Date()): [number, number] | null {
  if (p === 'all') return null;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (p === 'week') { const sun = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()); return [sun.getTime(), new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + 7).getTime()]; }
  return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()];
}

interface Row { status: string; due_date: string | null; completed_at?: string | null }

export function countTasks(rows: Row[], p: Period, now = new Date()) {
  const b = periodBounds(p, now), t = now.getTime();
  const inP = (s?: string | null) => !b || (!!s && Date.parse(s) >= b[0] && Date.parse(s) < b[1]);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), end = start + 864e5;
  const c = { done: 0, cycle: 0, active: 0, pending: 0, open: 0, overdue: 0, dueToday: 0, waiting: 0 };
  for (const r of rows) {
    const due = r.due_date ? Date.parse(r.due_date) : null;
    if (r.status === 'completed' || r.status === 'completed_cycle') {
      // all time also counts completed tasks from before completed_at was recorded
      if (!b || inP(r.completed_at)) { c.done++; if (r.status === 'completed_cycle') c.cycle++; }
      continue;
    }
    if (due !== null && due >= start && due < end) c.dueToday++;
    if (!inP(r.due_date)) continue;
    c.open++;
    if (r.status === 'started') c.active++; else c.pending++;
    if (r.status === 'pending') c.waiting++;
    if (due !== null && due < t) c.overdue++;
  }
  return c;
}
