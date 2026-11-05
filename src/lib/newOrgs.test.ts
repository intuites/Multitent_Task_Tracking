import { describe, it, expect } from 'vitest';
import { isNewOrg } from './newOrgs';

describe('new organization badge', () => {
  const now = Date.parse('2026-11-06T12:00:00Z');
  it('is new for 7 days, until seen', () => {
    expect(isNewOrg({ id: 'a', created_at: '2026-11-05T12:00:00Z' }, new Set(), now)).toBe(true);
    expect(isNewOrg({ id: 'a', created_at: '2026-11-05T12:00:00Z' }, new Set(['a']), now)).toBe(false);
    expect(isNewOrg({ id: 'b', created_at: '2026-10-29T11:00:00Z' }, new Set(), now)).toBe(false); // older than 7 days
  });
});
