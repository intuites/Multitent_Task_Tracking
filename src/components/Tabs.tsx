import { useRef, type KeyboardEvent } from 'react';

// WAI-ARIA tabs: roving tabindex, arrow/Home/End keys. Pair with <div {...panelProps(prefix, value)}>.
export const panelProps = (prefix: string, value: string) =>
  ({ role: 'tabpanel', id: `${prefix}-panel`, 'aria-labelledby': `${prefix}-tab-${value}`, tabIndex: 0 }) as const;

export function Tabs<T extends string>({ prefix, tabs, value, onChange, label }: {
  prefix: string; tabs: readonly T[]; value: T; onChange: (t: T) => void; label: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  function onKey(e: KeyboardEvent, i: number) {
    const next = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length
      : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next]);
    refs.current[tabs[next]]?.focus();
  }
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button key={t} ref={(el) => { refs.current[t] = el; }} role="tab" id={`${prefix}-tab-${t}`} aria-controls={`${prefix}-panel`}
          aria-selected={value === t} tabIndex={value === t ? 0 : -1} onClick={() => onChange(t)} onKeyDown={(e) => onKey(e, i)}>{t}</button>
      ))}
    </div>
  );
}
