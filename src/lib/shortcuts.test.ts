import { describe, expect, it } from 'vitest';
import { keyName, match, printKey, SHORTCUTS, shortcutsFor } from './shortcuts';
import { NAV } from './nav';

const keys = (role: Parameters<typeof shortcutsFor>[0], platform = false) => shortcutsFor(role, platform).map((s) => s.keys.join(' '));
const ev = (key: string, mods: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey', boolean>> = {}, code?: string) =>
  ({ key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, code, ...mods });

describe('shortcuts per role', () => {
  it('employees get only what they can open', () => {
    const k = keys('employee');
    expect(k).toEqual(expect.arrayContaining(['g d', 'g m', 'g c', 'g n', 'g i', 'g h', 'g k', '/', '?', 'Shift+d']));
    for (const no of ['c t', 'Alt+t', 'c i', 'c o', 'g t', 'g l', 'g e', 'g r', 'g a', 'g s', 'g p']) expect(k).not.toContain(no);
  });
  it('admins get create and admin pages, not the platform admin site', () => {
    const k = keys('admin');
    expect(k).toEqual(expect.arrayContaining(['c t', 'Alt+t', 'c i', 'c o', 'g t', 'g l', 'g e', 'g r', 'g a', 'g s']));
    expect(k).not.toContain('g p');
  });
  it('platform admins get everything', () => {
    expect(keys('owner', true)).toEqual(SHORTCUTS.map((s) => s.keys.join(' ')));
  });
  it('every page shortcut opens a page that role can reach, and no two shortcuts share keys', () => {
    for (const s of SHORTCUTS.filter((x) => x.to && x.group === 'Go to' && !x.platformOnly && x.to !== '/shortcuts')) {
      const nav = NAV.find((n) => n.path === s.to);
      expect(nav, s.to).toBeTruthy();
      expect(s.needs).toBe(nav!.needs);
    }
    const all = SHORTCUTS.map((s) => s.keys.join(' '));
    expect(new Set(all).size).toBe(all.length);
  });
  it('no single key also starts a sequence (C and G are only prefixes)', () => {
    const singles = SHORTCUTS.filter((s) => s.keys.length === 1).map((s) => s.keys[0]);
    expect(singles).not.toContain('c');
    expect(singles).not.toContain('g');
  });
});

describe('reading keys', () => {
  it('names key presses', () => {
    expect(keyName(ev('t'))).toBe('t');
    expect(keyName(ev('T', { shiftKey: true }))).toBe('Shift+t');
    expect(keyName(ev('†', { altKey: true }, 'KeyT'))).toBe('Alt+t'); // Alt on a Mac types symbols
    expect(keyName(ev('k', { ctrlKey: true }))).toBe('Ctrl+k');
    expect(keyName(ev('?', { shiftKey: true }))).toBe('?');
    expect(keyName(ev('Shift', { shiftKey: true }))).toBeNull();
  });
  it('matches sequences', () => {
    const admin = shortcutsFor('admin', false), emp = shortcutsFor('employee', false);
    expect(match(admin, ['c'])).toBe('wait');
    expect((match(admin, ['c', 't']) as any).to).toBe('/tasks?new=1');
    expect((match(admin, ['Alt+t']) as any).to).toBe('/tasks?new=1');
    expect((match(admin, ['g', 'r']) as any).to).toBe('/reports');
    expect(match(emp, ['c'])).toBeNull(); // employees cannot create, so C does nothing
    expect(match(emp, ['g', 'r'])).toBeNull();
    expect(match(admin, ['g', 'z'])).toBeNull();
    expect(match(admin, ['Ctrl+k'])).toBeNull(); // handled by the search box itself
    expect(printKey('Alt+t')).toEqual(['Alt', 'T']);
  });
});
