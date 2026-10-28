import { describe, it, expect } from 'vitest';
import { can } from './permissions';
import { canTransition, createsCycle, DEFAULT_TASK_STATUS } from './taskStatus';

describe('permissions', () => {
  it('denies unknown role and client_user', () => {
    expect(can(undefined, 'task:read')).toBe(false);
    expect(can('client_user', 'task:read')).toBe(false);
  });
  it('employee cannot write clients; manager can', () => {
    expect(can('employee', 'client:write')).toBe(false);
    expect(can('manager', 'client:write')).toBe(true);
  });
});
describe('task status', () => {
  it('defaults to not_yet_started', () => expect(DEFAULT_TASK_STATUS).toBe('not_yet_started'));
  it('blocks invalid transitions', () => {
    expect(canTransition('not_yet_started', 'completed')).toBe(false);
    expect(canTransition('in_progress', 'completed')).toBe(true);
  });
  it('detects cycles', () => {
    const e = new Map([['a', ['b']], ['b', ['c']]]);
    expect(createsCycle(e, 'c', 'a')).toBe(true);
    expect(createsCycle(e, 'a', 'c')).toBe(false);
    expect(createsCycle(e, 'a', 'a')).toBe(true);
  });
});

import { projectProgress } from './progress';
describe('projectProgress', () => {
  it('uses manual value in manual mode', () => expect(projectProgress('manual', 40, [], [])).toBe(40));
  it('calculates from milestones', () =>
    expect(projectProgress('milestones', 0, [{ completed_at: 'x' }, { completed_at: null }], [])).toBe(50));
  it('ignores cancelled tasks and handles empty', () => {
    const t = [{ status: 'completed' }, { status: 'cancelled' }, { status: 'in_progress' }];
    expect(projectProgress('tasks', 0, [], t)).toBe(50);
    expect(projectProgress('tasks', 0, [], [])).toBe(0);
  });
});
