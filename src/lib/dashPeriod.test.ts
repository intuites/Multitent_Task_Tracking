import { describe, expect, it } from 'vitest';
import { countTasks, periodBounds } from './dashPeriod';

// Wednesday 11 Nov 2026, 15:00 local
const now = new Date(2026, 10, 11, 15);
const at = (m: number, d: number, h = 12) => new Date(2026, m, d, h).toISOString();
const rows = [
  { status: 'started', due_date: at(10, 10) },                       // this week, overdue
  { status: 'pending', due_date: at(10, 11, 18) },                   // today
  { status: 'not_yet_started', due_date: at(10, 25) },               // this month, not this week
  { status: 'started', due_date: at(11, 20) },                       // next month
  { status: 'not_yet_started', due_date: null },                     // no due date
  { status: 'completed', due_date: at(9, 1), completed_at: at(10, 9) },        // done this week
  { status: 'completed_cycle', due_date: null, completed_at: at(10, 2) },      // done this month
  { status: 'completed', due_date: null, completed_at: null },                 // done, date unknown
];

describe('dashboard period', () => {
  it('weeks run Sunday to Saturday, months the calendar month', () => {
    expect(periodBounds('week', now)).toEqual([new Date(2026, 10, 8).getTime(), new Date(2026, 10, 15).getTime()]);
    expect(periodBounds('month', now)).toEqual([new Date(2026, 10, 1).getTime(), new Date(2026, 11, 1).getTime()]);
    expect(periodBounds('all', now)).toBeNull();
  });

  it('counts open work by due date and completed work by completion date', () => {
    expect(countTasks(rows, 'week', now)).toMatchObject({ open: 2, active: 1, waiting: 1, overdue: 1, dueToday: 1, done: 1, cycle: 0 });
    expect(countTasks(rows, 'month', now)).toMatchObject({ open: 3, overdue: 1, dueToday: 1, done: 2, cycle: 1 });
    expect(countTasks(rows, 'all', now)).toMatchObject({ open: 5, active: 2, pending: 3, overdue: 1, dueToday: 1, done: 3, cycle: 1 });
  });
});
