import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Download, FileSpreadsheet, FileText } from 'lucide-react';

export type ExportFormat = 'xlsx' | 'pdf';
const FORMATS: { id: ExportFormat; name: string; hint: string; icon: typeof FileText }[] = [
  { id: 'xlsx', name: 'Excel (.xlsx)', hint: 'Coloured sheets with charts', icon: FileSpreadsheet },
  { id: 'pdf', name: 'PDF', hint: 'Print-ready report, then “Save as PDF”', icon: FileText },
];

/** One Export button that asks for the format. onExport may be async; the button shows progress until it settles. */
export default function ExportMenu({ onExport, disabled, label = 'Export' }: { onExport: (f: ExportFormat) => unknown; disabled?: boolean; label?: string }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState<ExportFormat | null>(null);
  const [pos, setPos] = useState<CSSProperties>({ visibility: 'hidden' });
  const ref = useRef<HTMLDivElement>(null), popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { const n = e.target as Node; if (!ref.current?.contains(n) && !popRef.current?.contains(n)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const close = (e: Event) => { if (!popRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc);
    window.addEventListener('scroll', close, true); window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close);
    };
  }, [open]);
  // drawn on <body>, placed by the button: a card's overflow (it scrolls wide tables) would otherwise cut the menu off
  useLayoutEffect(() => {
    if (!open) return setPos({ visibility: 'hidden' });
    const b = ref.current!.getBoundingClientRect(), p = popRef.current!.getBoundingClientRect(), gap = 10, edge = 12;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    // lines up with the button's left edge when the button sits in the left half of the screen, else its right edge
    let left = (b.left + b.right) / 2 < vw / 2 ? b.left : b.right - p.width;
    left = Math.max(edge, Math.min(left, vw - p.width - edge));
    const below = b.bottom + gap + p.height <= vh - edge || b.top - gap - p.height < edge;
    setPos({ left, right: 'auto', top: below ? b.bottom + gap : b.top - gap - p.height, transformOrigin: `${left === b.left ? 'left' : 'right'} ${below ? 'top' : 'bottom'}` });
  }, [open]);
  async function pick(f: ExportFormat) {
    setOpen(false); setBusy(f);
    try { await onExport(f); } finally { setBusy(null); }
  }
  return (
    <div className="pop-wrap" ref={ref}>
      <button type="button" className="pill-btn" aria-haspopup="menu" aria-expanded={open} disabled={disabled || !!busy} onClick={() => setOpen(!open)}>
        <Download size={16} aria-hidden="true" />{busy ? `Preparing ${busy === 'xlsx' ? 'Excel' : 'PDF'}…` : label}<ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div ref={popRef} className="pop menu-pop export-pop" role="menu" aria-label="Choose export format" style={pos}>
          {FORMATS.map((f) => (
            <button key={f.id} role="menuitem" type="button" className="menu-item export-item" onClick={() => pick(f.id)}>
              <f.icon size={18} aria-hidden="true" /><span><b>{f.name}</b><small>{f.hint}</small></span>
            </button>))}
        </div>, document.body)}
    </div>
  );
}
