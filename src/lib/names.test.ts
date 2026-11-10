import { describe, expect, it } from 'vitest';
import { pickName } from './names';

describe('pickName', () => {
  const mahesh = { id: 'm', name: 'Mahesh', email: 'mahesh@a.com' };
  const rahul1 = { id: 'r1', name: 'Rahul', email: 'rahul@a.com' }, rahul2 = { id: 'r2', name: 'rahul ', email: 'r2@a.com' };
  const all = [mahesh, rahul1, rahul2];
  it('marks the signed-in person', () => {
    expect(pickName(mahesh, all, 'm')).toBe('Mahesh (Me)');
    expect(pickName(mahesh, all, 'x')).toBe('Mahesh');
  });
  it('adds the email only when the name is shared', () => {
    expect(pickName(rahul1, all, 'x')).toBe('Rahul (rahul@a.com)');
    expect(pickName(rahul2, all, 'r2')).toBe('rahul (r2@a.com) (Me)');
  });
});
