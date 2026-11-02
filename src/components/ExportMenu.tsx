import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, FileText, Sheet } from 'lucide-react';

export type ExportFormat = 'xlsx' | 'csv' | 'pdf';
const FORMATS: { id: ExportFormat; name: string; hint: string; icon: typeof Sheet }[] = [
  { id: 'xlsx', name: 'Excel (.xlsx)', hint: 'Coloured sheets with charts', icon: FileSpreadsheet },
  { id: 'csv', name: 'CSV (.csv)', hint: 'Plain data for any tool', icon: Sheet },
  { id: 'pdf', name: 'PDF', hint: 'Print-ready report, then “Save as PDF”', icon: FileText },
];

/** One Export button that asks for the format. onExport may be async; the button shows progress until it settles. */
export default function ExportMenu({ onExport, disabled, label = 'Export' }: { onExport: (f: ExportFormat) => unknown; disabled?: boolean; label?: string }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState<ExportFormat | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  async function pick(f: ExportFormat) {
    setOpen(false); setBusy(f);
    try { await onExport(f); } finally { setBusy(null); }
  }
  return (
    <div className="pop-wrap" ref={ref}>
      <button type="button" className="pill-btn" aria-haspopup="menu" aria-expanded={open} disabled={disabled || !!busy} onClick={() => setOpen(!open)}>
        <Download size={16} aria-hidden="true" />{busy ? `Preparing ${busy === 'xlsx' ? 'Excel' : busy.toUpperCase()}…` : label}<ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div className="pop menu-pop export-pop" role="menu" aria-label="Choose export format">
          {FORMATS.map((f) => (
            <button key={f.id} role="menuitem" type="button" className="menu-item export-item" onClick={() => pick(f.id)}>
              <f.icon size={18} aria-hidden="true" /><span><b>{f.name}</b><small>{f.hint}</small></span>
            </button>))}
        </div>)}
    </div>
  );
}
