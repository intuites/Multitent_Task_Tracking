import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Replaces the browser's date picker for every <input type="date"> with a styled calendar, the way SelectEnhancer
// does for dropdowns. The real input stays the source of truth (forms, FormData, React onChange keep working);
// typing a date still works, and touch devices keep the native picker.
const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
const enhanced = (el: EventTarget | null): el is HTMLInputElement =>
  el instanceof HTMLInputElement && el.type === 'date' && !el.disabled && !el.readOnly && !el.closest('[data-native-date]');

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : null);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export default function DateEnhancer() {
  const [el, setEl] = useState<HTMLInputElement | null>(null);
  const [month, setMonth] = useState(() => new Date());
  const [active, setActive] = useState('');
  const [dir, setDir] = useState(0);
  const [pos, setPos] = useState({ top: 0, left: 0, up: false });
  const popRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const elRef = useRef<HTMLInputElement | null>(null);
  elRef.current = el;

  const open = (input: HTMLInputElement) => {
    const start = parse(input.value) ?? new Date();
    const d = parse(input.min) && start < parse(input.min)! ? parse(input.min)! : start;
    setMonth(new Date(d.getFullYear(), d.getMonth(), 1, 12)); setActive(iso(d)); setDir(0); setEl(input);
  };
  const close = (refocus = true) => { if (refocus) el?.focus(); setEl(null); };
  const allowed = (s: string) => !!el && (!el.min || s >= el.min) && (!el.max || s <= el.max);
  const choose = (s: string) => {
    if (!el || (s && !allowed(s))) return;
    if (el.value !== s) {
      valueSetter.call(el, s);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    close();
  };

  useEffect(() => {
    if (window.matchMedia('(pointer: coarse)').matches) return;
    const down = (e: MouseEvent) => {
      if (!enhanced(e.target) || e.button !== 0) return;
      e.preventDefault(); // stops the native picker
      const input = e.target;
      input.focus();
      if (elRef.current === input) setEl(null); else open(input);
    };
    const click = (e: MouseEvent) => { if (enhanced(e.target)) e.preventDefault(); };
    const key = (e: KeyboardEvent) => {
      if (!enhanced(e.target)) return;
      if (e.key === 'Enter' || e.key === ' ' || (e.altKey && e.key === 'ArrowDown')) { e.preventDefault(); open(e.target); }
    };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', key, true);
    };
  }, []);

  // sit under the field (or above it when there's no room) and follow it while scrolling
  useLayoutEffect(() => {
    if (!el) return;
    const place = () => {
      const r = el.getBoundingClientRect(), h = popRef.current?.offsetHeight ?? 380, w = 336;
      if (r.bottom < 0 || r.top > window.innerHeight) return close(false);
      const up = window.innerHeight - r.bottom < h + 16 && r.top > h + 16;
      setPos({ top: up ? r.top - 8 : r.bottom + 8, left: Math.max(12, Math.min(r.left, window.innerWidth - w - 12)), up });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    const outside = (e: MouseEvent) => { const t = e.target as Node; if (!popRef.current?.contains(t) && !enhanced(t)) close(false); };
    document.addEventListener('mousedown', outside);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); document.removeEventListener('mousedown', outside); };
  }, [el]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (el) gridRef.current?.focus({ preventScroll: true }); }, [el]);

  if (!el) return null;
  const today = iso(new Date());
  const shift = (n: number) => { setDir(n); setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1, 12)); };
  const moveActive = (n: number) => {
    const d = addDays(parse(active) ?? new Date(), n), s = iso(d);
    setActive(s);
    if (d.getMonth() !== month.getMonth() || d.getFullYear() !== month.getFullYear()) { setDir(n > 0 ? 1 : -1); setMonth(new Date(d.getFullYear(), d.getMonth(), 1, 12)); }
  };
  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key, m: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (k in m) { e.preventDefault(); moveActive(m[k]); }
    else if (k === 'PageUp' || k === 'PageDown') { e.preventDefault(); const d = parse(active)!; d.setMonth(d.getMonth() + (k === 'PageUp' ? -1 : 1)); moveActive(Math.round((d.getTime() - parse(active)!.getTime()) / 864e5)); }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); choose(active); }
    else if (k === 'Escape' || k === 'Tab') { e.preventDefault(); close(); }
  };

  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i - first.getDay()));
  const rows = days[35].getMonth() === month.getMonth() ? days : days.slice(0, 35);
  const title = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const quick: [string, string][] = [['Today', today], ['Tomorrow', iso(addDays(new Date(), 1))], ['Next week', iso(addDays(new Date(), 7))]];
  const label = el.getAttribute('aria-label') ?? el.labels?.[0]?.textContent?.trim() ?? 'Choose a date';

  return createPortal(
    <div ref={popRef} className={`dp ${pos.up ? 'up' : ''}`} role="dialog" aria-label={label}
      style={{ left: pos.left, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}>
      <span className="dp-blob a" aria-hidden="true" /><span className="dp-blob b" aria-hidden="true" />
      <div className="dp-head">
        <button type="button" className="dp-nav" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft size={17} /></button>
        <b aria-live="polite">{title}</b>
        <button type="button" className="dp-nav" aria-label="Next month" onClick={() => shift(1)}><ChevronRight size={17} /></button>
      </div>
      <div className="dp-dow" aria-hidden="true">{DOW.map((d) => <span key={d}>{d}</span>)}</div>
      <div ref={gridRef} key={title} className={`dp-grid ${dir > 0 ? 'next' : dir < 0 ? 'prev' : ''}`} role="grid" tabIndex={0} onKeyDown={onKey}
        aria-activedescendant={`dp-${active}`}>
        {rows.map((d) => {
          const s = iso(d), out = d.getMonth() !== month.getMonth();
          return (
            <button type="button" tabIndex={-1} key={s} id={`dp-${s}`} role="gridcell" disabled={!allowed(s)}
              aria-selected={s === el.value} aria-current={s === today ? 'date' : undefined}
              className={['dp-day', out && 'out', s === active && 'active', s === today && 'today', s === el.value && 'sel'].filter(Boolean).join(' ')}
              aria-label={d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              onMouseEnter={() => setActive(s)} onClick={() => choose(s)}>{d.getDate()}</button>
          );
        })}
      </div>
      <div className="dp-foot">
        {quick.filter(([, s]) => allowed(s)).map(([t, s]) => <button type="button" key={t} className="dp-chip" onClick={() => choose(s)}>{t}</button>)}
        {!el.required && el.value && <button type="button" className="dp-chip clear" onClick={() => choose('')}>Clear</button>}
      </div>
    </div>,
    document.body,
  );
}
