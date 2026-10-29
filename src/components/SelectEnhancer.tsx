import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Search } from 'lucide-react';

// Replaces the browser's native dropdown list for every single-choice <select> on the page with a styled one.
// The real <select> stays in place as the source of truth (forms, FormData and React onChange keep working);
// touch devices keep the native picker, which is better there.
const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
const enhanced = (el: EventTarget | null): el is HTMLSelectElement =>
  el instanceof HTMLSelectElement && !el.multiple && el.size <= 1 && !el.disabled && !el.closest('[data-native-select]');

interface Opt { value: string; text: string; disabled: boolean }

export default function SelectEnhancer() {
  const [sel, setSel] = useState<HTMLSelectElement | null>(null);
  const [opts, setOpts] = useState<Opt[]>([]);
  const [active, setActive] = useState(0);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, up: false, max: 320 });
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const selRef = useRef<HTMLSelectElement | null>(null);
  selRef.current = sel;

  const open = (el: HTMLSelectElement) => {
    const o = [...el.options].map((x) => ({ value: x.value, text: x.text, disabled: x.disabled }));
    setOpts(o); setQ(''); setSel(el);
    setActive(Math.max(0, el.selectedIndex));
  };
  const close = (refocus = true) => { if (refocus) sel?.focus(); setSel(null); };
  const choose = (o: Opt) => {
    if (!sel || o.disabled) return;
    if (sel.value !== o.value) { valueSetter.call(sel, o.value); sel.dispatchEvent(new Event('change', { bubbles: true })); }
    close();
  };

  useEffect(() => {
    if (window.matchMedia('(pointer: coarse)').matches) return;
    const down = (e: MouseEvent) => {
      if (!enhanced(e.target) || e.button !== 0) return;
      e.preventDefault(); // stops the native list from opening
      const el = e.target;
      el.focus();
      if (selRef.current === el) setSel(null); else open(el);
    };
    const key = (e: KeyboardEvent) => {
      if (!enhanced(e.target)) return;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'F4' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp'))) {
        e.preventDefault(); open(e.target);
      }
    };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', down, true); document.removeEventListener('keydown', key, true); };
  }, []);

  // place the list under the field (or above it when there's no room), and follow it while scrolling
  useLayoutEffect(() => {
    if (!sel) return;
    const place = () => {
      const r = sel.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return close(false);
      const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
      const up = below < 220 && above > below;
      setPos({ top: up ? r.top - 6 : r.bottom + 6, left: r.left, width: Math.max(r.width, 200), up, max: Math.min(340, up ? above : below) });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    // clicks on another dropdown are handled by the opener above, so only close for clicks elsewhere
    const outside = (e: MouseEvent) => { const t = e.target as Node; if (!listRef.current?.parentElement?.contains(t) && !enhanced(t)) close(false); };
    document.addEventListener('mousedown', outside);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); document.removeEventListener('mousedown', outside); };
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const searchable = opts.length > 7;
  const shown = q ? opts.filter((o) => o.text.toLowerCase().includes(q.toLowerCase())) : opts;
  useEffect(() => { if (sel && searchable) searchRef.current?.focus(); else if (sel) listRef.current?.focus(); }, [sel, searchable]);
  useEffect(() => { listRef.current?.querySelector('[data-active=true]')?.scrollIntoView({ block: 'nearest' }); }, [active, sel]);
  useEffect(() => { setActive((a) => Math.min(a, Math.max(0, shown.length - 1))); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!sel) return null;
  const move = (d: number) => {
    let i = active;
    for (let n = 0; n < shown.length; n++) { i = (i + d + shown.length) % shown.length; if (!shown[i].disabled) break; }
    setActive(i);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(shown.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) choose(shown[active]); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(); }
    else if (!searchable && e.key.length === 1) {
      // type-ahead like a native select
      const now = Date.now(), t = typed.current;
      t.text = now - t.at > 700 ? e.key.toLowerCase() : t.text + e.key.toLowerCase(); t.at = now;
      const i = shown.findIndex((o) => o.text.toLowerCase().startsWith(t.text));
      if (i >= 0) setActive(i);
    }
  };
  const id = 'sel-list';
  const current = sel.value;

  return createPortal(
    <div className={`sel-pop ${pos.up ? 'up' : ''}`} style={{ left: pos.left, width: pos.width, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }} onKeyDown={onKey}>
      {searchable && (
        <div className="sel-search"><Search size={15} aria-hidden="true" />
          <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search options"
            role="combobox" aria-expanded="true" aria-controls={id} aria-activedescendant={shown[active] ? `${id}-${active}` : undefined} />
        </div>
      )}
      <ul ref={listRef} id={id} role="listbox" tabIndex={-1} aria-label={sel.getAttribute('aria-label') ?? sel.labels?.[0]?.textContent ?? 'Options'}
        aria-activedescendant={shown[active] ? `${id}-${active}` : undefined} style={{ maxHeight: pos.max - (searchable ? 48 : 0) }}>
        {shown.length === 0 && <li className="sel-empty">No matches</li>}
        {shown.map((o, i) => (
          <li key={`${o.value}-${i}`} id={`${id}-${i}`} role="option" aria-selected={o.value === current} aria-disabled={o.disabled || undefined}
            data-active={i === active} className={[o.value === '' ? 'placeholder' : '', o.disabled ? 'disabled' : ''].join(' ')}
            onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)}>
            <span>{o.text}</span>{o.value === current && o.value !== '' && <Check size={15} aria-hidden="true" />}
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}
