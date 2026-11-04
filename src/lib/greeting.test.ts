import { describe, expect, it } from 'vitest';
import { greeting, safeZone } from './greeting';

// 2026-11-04 15:26 UTC = 20:56 in Kolkata, 10:26 in New York, 00:26 next day in Tokyo, 07:26 in Los Angeles
const at = new Date('2026-11-04T15:26:00Z');

describe('greeting follows the organization time zone', () => {
  it('same moment, different zones', () => {
    expect(greeting(at, 'Asia/Calcutta')).toBe('Good evening');
    expect(greeting(at, 'America/New_York')).toBe('Good morning');
    expect(greeting(at, 'Asia/Tokyo')).toBe('Good night');
    expect(greeting(at, 'America/Los_Angeles')).toBe('Good morning');
    expect(greeting(at, 'Europe/London')).toBe('Good afternoon');
  });
  it('switches at 5, 12, 17 and 21 o’clock', () => {
    const utc = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 4, h, m));
    expect(greeting(utc(4, 59), 'UTC')).toBe('Good night');
    expect(greeting(utc(5), 'UTC')).toBe('Good morning');
    expect(greeting(utc(11, 59), 'UTC')).toBe('Good morning');
    expect(greeting(utc(12), 'UTC')).toBe('Good afternoon');
    expect(greeting(utc(16, 59), 'UTC')).toBe('Good afternoon');
    expect(greeting(utc(17), 'UTC')).toBe('Good evening');
    expect(greeting(utc(20, 59), 'UTC')).toBe('Good evening');
    expect(greeting(utc(21), 'UTC')).toBe('Good night');
    expect(greeting(utc(0), 'UTC')).toBe('Good night');
  });
  it('falls back to the viewer’s zone when the saved one is missing or unknown', () => {
    const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(safeZone(null)).toBe(own);
    expect(safeZone('Not/AZone')).toBe(own);
    expect(safeZone('Asia/Calcutta')).toBe('Asia/Calcutta');
  });
});
