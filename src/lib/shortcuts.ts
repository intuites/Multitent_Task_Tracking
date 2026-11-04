// Keyboard shortcuts. Easy to remember: C + letter creates, G + letter goes to a page (the page's first letter),
// a few single keys work anywhere. Each role only gets the shortcuts for what it can open.
// Ctrl+T / Ctrl+N / Ctrl+W are taken by the browser (new tab, new window, close tab) and never reach a web page,
// so New task is C then T, or Alt+T.
import { can, type Action, type Role } from '../../api/_lib/permissions';

export type ShortcutGroup = 'Create' | 'Go to' | 'Anywhere';
export interface Shortcut {
  /** Keys pressed one after another; 'Alt+t', 'Ctrl+k' are chords. */
  keys: string[];
  label: string;
  group: ShortcutGroup;
  /** Page to open. */
  to?: string;
  /** Something the app does instead of opening a page. */
  run?: 'search' | 'sidebar' | 'theme';
  needs?: Action;
  platformOnly?: boolean;
  /** Also listed, but handled by the component that owns it (search box, sidebar). */
  builtIn?: boolean;
}

export const SHORTCUTS: Shortcut[] = [
  { keys: ['c', 't'], label: 'Create a task', group: 'Create', to: '/tasks?new=1', needs: 'task:write' },
  { keys: ['Alt+t'], label: 'Create a task', group: 'Create', to: '/tasks?new=1', needs: 'task:write' },
  { keys: ['c', 'i'], label: 'Invite people', group: 'Create', to: '/employees?invite=1', needs: 'members:manage' },
  { keys: ['c', 'o'], label: 'Create an organization', group: 'Create', to: '/organizations/new', needs: 'org:manage' },

  { keys: ['g', 'd'], label: 'Dashboard', group: 'Go to', to: '/' },
  { keys: ['g', 'm'], label: 'My tasks', group: 'Go to', to: '/my-tasks', needs: 'task:read' },
  { keys: ['g', 't'], label: 'Tasks', group: 'Go to', to: '/tasks', needs: 'task:write' },
  { keys: ['g', 'l'], label: 'Task templates (library)', group: 'Go to', to: '/templates', needs: 'task:write' },
  { keys: ['g', 'c'], label: 'Calendar', group: 'Go to', to: '/calendar', needs: 'task:read' },
  { keys: ['g', 'e'], label: 'Employees & departments', group: 'Go to', to: '/employees', needs: 'task:write' },
  { keys: ['g', 'r'], label: 'Reports', group: 'Go to', to: '/reports', needs: 'report:read' },
  { keys: ['g', 'a'], label: 'Activity logs', group: 'Go to', to: '/activity', needs: 'task:write' },
  { keys: ['g', 'n'], label: 'Notifications', group: 'Go to', to: '/notifications' },
  { keys: ['g', 's'], label: 'Organization settings', group: 'Go to', to: '/settings', needs: 'task:write' },
  { keys: ['g', 'i'], label: 'My profile (I = me)', group: 'Go to', to: '/profile' },
  { keys: ['g', 'h'], label: 'Help & guide', group: 'Go to', to: '/guide' },
  { keys: ['g', 'k'], label: 'Keyboard shortcuts', group: 'Go to', to: '/shortcuts' },
  { keys: ['g', 'p'], label: 'Admin site (platform)', group: 'Go to', to: '/admin-site', platformOnly: true },

  { keys: ['/'], label: 'Search tasks and people', group: 'Anywhere', run: 'search' },
  { keys: ['Ctrl+k'], label: 'Search tasks and people', group: 'Anywhere', run: 'search', builtIn: true },
  { keys: ['Ctrl+b'], label: 'Collapse or expand the sidebar', group: 'Anywhere', run: 'sidebar', builtIn: true },
  { keys: ['Shift+d'], label: 'Switch light and dark mode', group: 'Anywhere', run: 'theme' },
  { keys: ['?'], label: 'Show these shortcuts', group: 'Anywhere', to: '/shortcuts' },
];

/** The shortcuts this person can use. */
export const shortcutsFor = (role: Role | undefined, platform: boolean) =>
  SHORTCUTS.filter((s) => (!s.platformOnly || platform) && (!s.needs || can(role, s.needs)));

/** A key event as the names used in `keys` ('t', 'Alt+t', 'Shift+d', '?'), or null for keys we ignore. */
export function keyName(e: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; code?: string }) {
  if (['Shift', 'Alt', 'Control', 'Meta'].includes(e.key)) return null;
  // with Alt held, some layouts turn letters into symbols; the physical key is in `code`
  const k = e.altKey && e.code?.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.ctrlKey || e.metaKey) return `Ctrl+${k}`;
  if (e.altKey) return `Alt+${k}`;
  if (e.shiftKey && /^[a-z]$/.test(k)) return `Shift+${k}`;
  return k; // '?' and '/' arrive as themselves
}

/** Given the keys pressed so far, the matching shortcut, 'wait' for a started sequence (C… / G…), or null. */
export function match(list: Shortcut[], pressed: string[]): Shortcut | 'wait' | null {
  const own = list.filter((s) => !s.builtIn);
  const hit = own.find((s) => s.keys.length === pressed.length && s.keys.every((k, i) => k === pressed[i]));
  if (hit) return hit;
  return own.some((s) => s.keys.length > pressed.length && pressed.every((k, i) => s.keys[i] === k)) ? 'wait' : null;
}

/** How a key is printed: 'Alt+t' -> ['Alt', 'T']. */
export const printKey = (k: string) => k.split('+').map((p) => (p.length === 1 ? p.toUpperCase() : p));
