import { describe, expect, it } from 'vitest';
import { buckets, dueWeek, headline, months12, smooth, sparks, throughput } from './dashStats';

// Thursday 12 Nov 2026, 15:00 local
const now = new Date(2026, 10, 12, 15);
const at = (m: number, d: number, h = 12) => new Date(2026, m, d, h).toISOString();
const rows = [
  { status: 'completed', created_at: at(10, 9), due_date: at(10, 11), completed_at: at(10, 10) },   // on time, this week, 1 day
  { status: 'completed', created_at: at(10, 2), due_date: at(10, 9), completed_at: at(10, 12, 9) }, // late, this week, 10 days
  { status: 'completed', created_at: at(9, 20), due_date: null, completed_at: at(10, 3) },          // last week
  { status: 'started', created_at: at(10, 10), due_date: at(10, 11) },                               // open, overdue
  { status: 'pending', created_at: at(10, 11), due_date: at(10, 12, 18) },                           // due later today
  { status: 'not_yet_started', created_at: at(10, 12, 8), due_date: at(10, 12, 10) },                // fell overdue today
];

describe('dashboard charts', () => {
  it('buckets: 7 days, the weeks of the month, or 12 months', () => {
    expect(buckets('week', now).map((b) => b.label)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(buckets('month', now)).toHaveLength(5);
    const all = buckets('all', now);
    expect(all).toHaveLength(12);
    expect(all[11].label).toBe('Nov');
  });

  it('throughput counts created, completed and overdue per bucket', () => {
    const wk = throughput(rows, 'week', now);
    const tue = wk[2], wed = wk[3], thu = wk[4];
    expect(tue).toMatchObject({ created: 1, completed: 1 });
    expect(wed).toMatchObject({ created: 1, overdue: 1 }); // the open task due Wednesday
    expect(thu).toMatchObject({ created: 1, completed: 1, overdue: 1, future: false });
    expect(wk[5].future).toBe(true);
  });

  it('headline numbers', () => {
    const h = headline(rows, 'week', now);
    expect(h.rate).toBe(40);       // 2 finished of 2 + 3 open due this week
    expect(h.onTime).toBe(50);     // 1 of the 2 finished with a due date
    expect(h.avgDays).toBe(5.4);   // (1 + 9.875) / 2
    expect(h.change).toBe(100);    // 2 this week vs 1 last week
  });

  it('due this week, overdue today and the next deadline today', () => {
    const w = dueWeek(rows, now);
    expect(w.bars).toEqual([0, 0, 0, 1, 2, 0, 0]);
    expect(w.lateToday).toBe(1);
    expect(w.nextToday).toBe(Date.parse(at(10, 12, 18)));
  });

  it('sparklines end on the current numbers', () => {
    const s = sparks(rows, 'week', now);
    expect(s.open).toHaveLength(12);
    expect(s.open[11]).toBe(3);
    expect(s.overdue[11]).toBe(2);
    expect(s.completed[11]).toBe(2);
  });

  it('12 months of completions, and a smooth path', () => {
    expect(months12(rows, now).map((m) => m.n).slice(-1)).toEqual([3]);
    expect(smooth([[0, 10], [10, 0], [20, 10]])).toMatch(/^M0\.0 10\.0 C.* 20\.0 10\.0$/);
    // flat, then a jump: no control point may go below the flat part (y grows downward in SVG)
    const ys = smooth([[0, 100], [10, 100], [20, 100], [30, 0]]).match(/-?\d+\.\d/g)!.filter((_, i) => i % 2 === 1).map(Number);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
  });
});
