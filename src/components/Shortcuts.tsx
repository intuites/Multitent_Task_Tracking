import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Keyboard } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { label } from '../lib/ui';
import { keyName, match, printKey, shortcutsFor, type Shortcut, type ShortcutGroup } from '../lib/shortcuts';

const TYPING = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
const PREFIX: Record<string, string> = { c: 'Create', g: 'Go to' };

/** Listens for shortcuts anywhere in the app (never while typing or while a dialog is open). After C or G it shows
 *  what the next key can be, and forgets the first key after a moment. */
export function ShortcutListener() {
  const { membership } = useAuth();
  const list = shortcutsFor(membership?.role, !!membership?.platform);
  const navigate = useNavigate();
  const { toggle } = useTheme();
  const act = useRef({ navigate, toggle, list });
  act.current = { navigate, toggle, list };
  const [pending, setPending] = useState<string[]>([]);

  useEffect(() => {
    let seq: string[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reset = () => { seq = []; setPending([]); clearTimeout(timer); };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      if ((e.target as HTMLElement | null)?.closest?.(TYPING) || document.querySelector('dialog[open]')) return reset();
      if (e.key === 'Escape') return reset();
      const k = keyName(e);
      if (!k) return;
      const m = match(act.current.list, [...seq, k]);
      if (m === 'wait') { e.preventDefault(); seq = [...seq, k]; setPending(seq); clearTimeout(timer); timer = setTimeout(reset, 3000); return; }
      reset();
      if (!m) return;
      e.preventDefault();
      if (m.to) act.current.navigate(m.to);
      else if (m.run === 'search') document.querySelector<HTMLInputElement>('.search input')?.focus();
      else if (m.run === 'theme') act.current.toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(timer); };
  }, []);

  if (!pending.length) return null;
  const next = list.filter((s) => s.keys.length > pending.length && pending.every((k, i) => s.keys[i] === k));
  // rendered on <body>: an animated (transformed) ancestor would otherwise pin "fixed" to itself instead of the screen
  return createPortal(
    <div className="kb-hint" role="status" aria-live="polite">
      <b><Keys keys={pending} /> {PREFIX[pending[0]] ?? ''}…</b>
      <ul>{next.map((s) => <li key={s.keys.join()}><kbd>{printKey(s.keys[pending.length]).join('+')}</kbd>{s.label}</li>)}</ul>
    </div>, document.body);
}

function Keys({ keys }: { keys: string[] }) {
  return <span className="kb-keys">{keys.map((k, i) => (
    <span key={i}>{i > 0 && <small>then</small>}{printKey(k).map((p, j) => <span key={j}>{j > 0 && '+'}<kbd>{p}</kbd></span>)}</span>
  ))}</span>;
}

const GROUPS: { name: ShortcutGroup; hint: string }[] = [
  { name: 'Create', hint: 'Press C, then the first letter of what you are making.' },
  { name: 'Go to', hint: 'Press G, then the first letter of the page.' },
  { name: 'Anywhere', hint: 'Single keys that work on every page.' },
];

/** The Shortcuts page: only the shortcuts your role can use. */
export default function ShortcutsPage() {
  const { membership } = useAuth();
  const list = shortcutsFor(membership?.role, !!membership?.platform);
  const who = membership?.platform ? 'Platform admin' : label(membership?.role ?? '');
  // two shortcuts for the same action (C then T, Alt+T) share a row
  const rows = (g: ShortcutGroup) => list.filter((s) => s.group === g).reduce<{ label: string; keys: Shortcut['keys'][] }[]>((acc, s) => {
    const row = acc.find((r) => r.label === s.label);
    if (row) row.keys.push(s.keys); else acc.push({ label: s.label, keys: [s.keys] });
    return acc;
  }, []);
  return (
    <div className="kb">
      <div className="page-head">
        <div>
          <h2 className="page-title">Shortcuts</h2>
          <p className="page-sub">Keyboard shortcuts for your role. Press <kbd>?</kbd> on any page to come back here.</p>
        </div>
        <span className="prio prio-low kb-role"><Keyboard size={14} aria-hidden="true" />{who}</span>
      </div>
      <div className="kb-grid">
        {GROUPS.map((g) => {
          const r = rows(g.name);
          if (!r.length) return null;
          return (
            <section key={g.name} className="card kb-card" aria-labelledby={`kb-${g.name}`}>
              <h3 id={`kb-${g.name}`}>{g.name}</h3>
              <p className="muted">{g.hint}</p>
              <ul className="kb-list">{r.map((row) => (
                <li key={row.label}><span>{row.label}</span>
                  <span className="kb-alts">{row.keys.map((k, i) => <span key={i}>{i > 0 && <small>or</small>}<Keys keys={k} /></span>)}</span></li>))}
              </ul>
            </section>);
        })}
      </div>
      <p className="muted kb-note">Shortcuts pause while you type in a box. Ctrl+T, Ctrl+N and Ctrl+W belong to the browser (new tab, new window, close tab), so Taskify uses C then T, or Alt+T, for a new task.</p>
    </div>
  );
}
