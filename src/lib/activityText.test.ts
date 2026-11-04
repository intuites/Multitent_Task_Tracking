import { describe as group, expect, it, vi } from 'vitest';
vi.mock('./supabase', () => ({ supabase: {} })); // label() lives in ui.tsx, which imports the browser-only client
import { byDay, describe, fold, type LogRow } from './activityText';

const person = (id?: string | null) => (id === 'u2' ? 'Priya Shah' : 'Unknown');
const title = (id: string) => (id === 't1' ? 'Fix login' : undefined);
const row = (p: Partial<LogRow>): LogRow => ({ id: Math.random().toString(), created_at: '2026-11-04T15:00:00Z', actor_id: 'u1', entity_type: 'task', entity_id: 't1', action: 'created', detail: {}, ...p });
const say = (p: Partial<LogRow>) => { const s = describe(row(p), person, title); return `${s.verb}${s.target ? ` ${s.target.text}` : ''}${s.rest ?? ''}`; };

group('activity sentences', () => {
  it('reads every kind of task activity', () => {
    expect(say({ action: 'status_changed', detail: { from: 'not_yet_started', to: 'in_progress' } })).toBe('moved Fix login from Not Yet Started to In Progress');
    expect(say({ action: 'assignee_added', detail: { user: 'u2' } })).toBe('assigned Priya Shah to Fix login');
    expect(say({ action: 'recurrence_set', detail: { every: 10, frequency: 'daily' } })).toBe('set Fix login to repeat every 10 days');
    expect(say({ action: 'recurrence_set', detail: { every: 1, frequency: 'weekly' } })).toBe('set Fix login to repeat every week');
    expect(say({ entity_id: 'gone', action: 'created' })).toBe('created a task');
    expect(describe(row({}), person, title).target?.to).toBe('/tasks/t1');
    expect(describe(row({ entity_id: 'gone' }), person, title).target?.to).toBe(''); // deleted task: no link
  });
  it('reads organization, people, project and client activity', () => {
    expect(say({ entity_type: 'organization', action: 'settings_updated' })).toBe('updated organization settings');
    expect(say({ entity_type: 'organization', action: 'role_changed', detail: { user: 'u2', to: 'admin' } })).toBe('changed Priya Shah’s role to Admin');
    expect(say({ entity_type: 'organization', action: 'member_invited', detail: { role: 'employee' } })).toBe('invited a new employee');
    expect(say({ entity_type: 'project', action: 'deleted', detail: { name: 'Abdul' } })).toBe('deleted project “Abdul”');
    expect(say({ entity_type: 'client', action: 'created' })).toBe('added a client');
    expect(say({ entity_type: 'client', action: 'something_new' })).toBe('something new on a client');
  });
  it('never crashes on a missing detail', () => {
    for (const action of ['status_changed', 'assignee_added', 'recurrence_set', 'cycle_set', 'role_changed', 'deleted'])
      for (const entity_type of ['task', 'organization', 'project']) expect(() => describe(row({ action, entity_type, detail: null }), person, title)).not.toThrow();
  });
});

group('folding and day groups', () => {
  it('folds back-to-back repeats only', () => {
    const s = row({ entity_type: 'organization', action: 'settings_updated', entity_id: 'o1' });
    const out = fold([s, { ...s, id: 'b' }, { ...s, id: 'c' }, row({ action: 'edited' }), { ...s, id: 'd' }]);
    expect(out.map((o) => o.count)).toEqual([3, 1, 1]);
    expect(fold([row({ action: 'status_changed', detail: { to: 'a' } }), row({ action: 'status_changed', detail: { to: 'b' } })])).toHaveLength(2);
  });
  it('groups by the organization’s day', () => {
    const now = new Date('2026-11-04T15:30:00Z'); // 21:00 in Kolkata
    const items = ['2026-11-04T15:00:00Z', '2026-11-03T20:00:00Z', '2026-11-03T10:00:00Z', '2026-10-30T10:00:00Z'];
    // 2026-11-03T20:00Z is already Nov 4 in Kolkata, but still Nov 3 in New York
    expect(byDay(items, (s) => s, 'Asia/Calcutta', now).map((g) => [g.title, g.items.length])).toEqual([['Today', 2], ['Yesterday', 1], ['Friday, October 30', 1]]);
    expect(byDay(items, (s) => s, 'America/New_York', now).map((g) => [g.title, g.items.length])).toEqual([['Today', 1], ['Yesterday', 2], ['Friday, October 30', 1]]);
  });
});
